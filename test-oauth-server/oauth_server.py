"""
Simple dummy OAuth authorization server for testing purposes.
Provides basic OAuth 2.0 endpoints with minimal validation.
"""

import base64
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, Tuple
from urllib.parse import urlencode, parse_qs
from flask import Flask, request, jsonify, redirect, make_response

logger = logging.getLogger(__name__)

app = Flask(__name__)

# CORS configuration
@app.after_request
def after_request(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization,Accept'
    response.headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS'
    response.headers['Access-Control-Allow-Credentials'] = 'true'
    return response

# Dummy client credentials (hardcoded for testing)
DUMMY_CLIENT_ID = "dummy_client_12345"
DUMMY_CLIENT_SECRET = "dummy_secret_abcdef123456"


def parse_client_credentials(auth_header: Optional[str] = None) -> Tuple[Optional[str], Optional[str]]:
    """
    Parse client credentials from Authorization header (Basic auth) or request body.
    Returns tuple of (client_id, client_secret) or (None, None) if not found.
    """
    client_id = None
    client_secret = None
    
    # Try Authorization header first (Basic auth)
    if auth_header and auth_header.startswith('Basic '):
        try:
            encoded_credentials = auth_header[6:]  # Remove 'Basic ' prefix
            decoded_credentials = base64.b64decode(encoded_credentials).decode('utf-8')
            client_id, client_secret = decoded_credentials.split(':', 1)
        except Exception as e:
            logger.warning(f"Failed to parse Basic auth header: {e}")
    
    # Fall back to request body if not in header
    if not client_id:
        content_type = request.headers.get('Content-Type', '')
        if 'application/x-www-form-urlencoded' in content_type:
            client_id = request.form.get('client_id')
            client_secret = request.form.get('client_secret')
        elif 'application/json' in content_type:
            json_data = request.get_json() if request.is_json else None
            if json_data:
                client_id = json_data.get('client_id')
                client_secret = json_data.get('client_secret')
    
    return client_id, client_secret


@app.route('/register', methods=['POST'])
def register():
    """
    Client registration endpoint.
    Returns consistent dummy client credentials.
    """
    try:
        data = request.get_json() or {}
        
        # Return the dummy client configuration
        dummy_config = {
            "client_id": DUMMY_CLIENT_ID,
            "client_secret": DUMMY_CLIENT_SECRET,
            "client_id_issued_at": int(datetime.utcnow().timestamp()),
            "client_secret_expires_at": 0,  # 0 = never expires (per spec)
            "redirect_uris": ["http://localhost:3000/callback", "http://localhost:8080/callback"],
            "token_endpoint_auth_method": "client_secret_basic",
            "grant_types": ["authorization_code"],
            "response_types": ["code"],
            "client_name": "Dummy OAuth Client",
            "client_uri": "http://localhost:3000",
            "scope": "read write admin",
        }
        
        print(f"[REGISTER] Dummy client registered: {DUMMY_CLIENT_ID}")
        print(f"[REGISTER] Client data: {json.dumps(dummy_config, indent=2)}")
        
        return jsonify(dummy_config)
        
    except Exception as e:
        logger.error(f"Registration error: {e}")
        return jsonify({'error': 'invalid_request', 'error_description': str(e)}), 400


@app.route('/.well-known/oauth-authorization-server', methods=['GET'])
def well_known_oauth():
    """
    OAuth 2.0 Authorization Server Metadata endpoint.
    Returns server capabilities and endpoint URLs.
    """
    base_url = request.host_url.rstrip('/')
    
    metadata = {
        'issuer': base_url,
        'authorization_endpoint': f'{base_url}/authorize',
        'token_endpoint': f'{base_url}/token',
        'registration_endpoint': f'{base_url}/register',
        'response_types_supported': ['code'],
        'grant_types_supported': ['authorization_code'],
        'token_endpoint_auth_methods_supported': ['client_secret_basic'],
        'scopes_supported': ['read', 'write', 'admin'],
        'code_challenge_methods_supported': ['S256', 'plain']
    }
    
    print(f"[WELL-KNOWN] Served metadata for issuer: {base_url}")
    return jsonify(metadata)


@app.route('/authorize', methods=['GET', 'POST'])
def authorize():
    """
    Authorization endpoint.
    Always returns successful authorization (dummy behavior).
    """
    try:
        # Extract parameters
        client_id = request.args.get('client_id') or request.form.get('client_id')
        redirect_uri = request.args.get('redirect_uri') or request.form.get('redirect_uri')
        response_type = request.args.get('response_type') or request.form.get('response_type', 'code')
        scope = request.args.get('scope') or request.form.get('scope', 'read')
        state = request.args.get('state') or request.form.get('state')
        code_challenge = request.args.get('code_challenge') or request.form.get('code_challenge')
        code_challenge_method = request.args.get('code_challenge_method') or request.form.get('code_challenge_method')
        
        print(f"[AUTHORIZE] Authorization request received:")
        print(f"[AUTHORIZE] client_id: {client_id}")
        print(f"[AUTHORIZE] redirect_uri: {redirect_uri}")
        print(f"[AUTHORIZE] response_type: {response_type}")
        print(f"[AUTHORIZE] scope: {scope}")
        print(f"[AUTHORIZE] state: {state}")
        print(f"[AUTHORIZE] code_challenge: {code_challenge}")
        print(f"[AUTHORIZE] code_challenge_method: {code_challenge_method}")
        
        if not client_id or not redirect_uri:
            return jsonify({'error': 'invalid_request', 'error_description': 'Missing required parameters'}), 400
        
        # Only support authorization code flow
        if response_type != 'code':
            return jsonify({'error': 'unsupported_response_type'}), 400
        
        # Generate dummy authorization code (always the same for simplicity)
        auth_code = "dummy_auth_code_12345"
        
        # Build redirect URL
        params = {'code': auth_code}
        if state:
            params['state'] = state
        
        redirect_url = f"{redirect_uri}?{urlencode(params)}"
        
        print(f"[AUTHORIZE] Authorization granted! Redirecting to: {redirect_url}")
        return redirect(redirect_url)
            
    except Exception as e:
        logger.error(f"Authorization error: {e}")
        return jsonify({'error': 'server_error', 'error_description': str(e)}), 500


@app.route('/token', methods=['POST'])
def token():
    """
    Token endpoint.
    Prints all received parameters and client credentials.
    """
    try:
        # Parse client credentials
        auth_header = request.headers.get('Authorization')
        client_id, client_secret = parse_client_credentials(auth_header)
        
        # Simple validation - just check if it matches our dummy credentials
        if client_id != DUMMY_CLIENT_ID or client_secret != DUMMY_CLIENT_SECRET:
            print(f"[TOKEN] Invalid client credentials: {client_id}")
            return jsonify({'error': 'invalid client credentials'}), 401
        
        # Parse request data based on content type
        content_type = request.headers.get('Content-Type', '')
        request_data = {}
        
        if 'application/x-www-form-urlencoded' in content_type:
            request_data = dict(request.form)
            print(f"[TOKEN] Processing application/x-www-form-urlencoded request")
        elif 'application/json' in content_type:
            try:
                request_data = request.get_json() or {}
                print(f"[TOKEN] Processing application/json request")
            except Exception as e:
                print(f"[TOKEN] Failed to parse JSON: {e}")
                request_data = {}
        else:
            print(f"[TOKEN] Unsupported content type: {content_type}")
            return jsonify({'error': 'invalid_request', 'error_description': 'Unsupported content type'}), 400
        
        print(f"\n[TOKEN] Token request received:")
        print(f"[TOKEN] Content-Type: {content_type}")
        print(f"[TOKEN] Authorization header: {auth_header}")
        print(f"[TOKEN] Parsed client_id: {client_id}")
        print(f"[TOKEN] Parsed client_secret: {client_secret}")
        print(f"[TOKEN] Request data: {json.dumps(request_data, indent=2)}")
        print(f"[TOKEN] All headers: {dict(request.headers)}")
        
        # Extract grant type and other parameters
        grant_type = request_data.get('grant_type')
        
        if grant_type != 'authorization_code':
            print(f"[TOKEN] Unsupported grant type: {grant_type}")
            return jsonify({'error': 'unsupported_grant_type'}), 400
        
        code = request_data.get('code')
        redirect_uri = request_data.get('redirect_uri')
        code_verifier = request_data.get('code_verifier')
        
        print(f"[TOKEN] Authorization code flow:")
        print(f"[TOKEN] code: {code}")
        print(f"[TOKEN] redirect_uri: {redirect_uri}")
        print(f"[TOKEN] code_verifier: {code_verifier}")
        
        # Always accept any authorization code (dummy server)
        print(f"[TOKEN] Accepting authorization code: {code}")
        
        # Generate dummy tokens (consistent for testing)
        access_token = "dummy_access_token_12345"
        refresh_token = "dummy_refresh_token_12345"
        
        token_response = {
            'access_token': access_token,
            'token_type': 'Bearer',
            'expires_in': 3600,
            'refresh_token': refresh_token,
            'scope': 'read write'
        }
        
        print(f"[TOKEN] Issuing tokens: {json.dumps(token_response, indent=2)}")
        logger.info(f"Token issued for client {client_id}")
        
        return jsonify(token_response)
        
    except Exception as e:
        logger.error(f"Token endpoint error: {e}")
        print(f"[TOKEN] Error: {e}")
        return jsonify({'error': 'server_error', 'error_description': str(e)}), 500


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    print("Starting minimal OAuth authorization server...")
    print("Available endpoints:")
    print("  POST /register - Client registration")
    print("  GET  /.well-known/oauth-authorization-server - Server metadata")
    print("  GET/POST /authorize - Authorization endpoint (code flow only)")
    print("  POST /token - Token endpoint")
    print(f"  Dummy client_id: {DUMMY_CLIENT_ID}")
    print(f"  Dummy client_secret: {DUMMY_CLIENT_SECRET}")
    app.run(host='0.0.0.0', port=8081, debug=True)