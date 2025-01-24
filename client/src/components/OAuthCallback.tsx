import { useEffect } from 'react';
import { handleOAuthCallback } from '../lib/auth';

const OAuthCallback = () => {
  useEffect(() => {
    const handleCallback = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const serverUrl = sessionStorage.getItem('mcp_server_url');

      if (!code || !serverUrl) {
        console.error('Missing code or server URL');
        window.location.href = '/';
        return;
      }

      try {
        const accessToken = await handleOAuthCallback(serverUrl, code);
        // Store the access token for future use
        sessionStorage.setItem('mcp_access_token', accessToken);
        // Redirect back to the main app
        window.location.href = '/';
      } catch (error) {
        console.error('OAuth callback error:', error);
        window.location.href = '/';
      }
    };

    void handleCallback();
  }, []);

  return (
    <div className="flex items-center justify-center h-screen">
      <p className="text-lg text-gray-500">Processing OAuth callback...</p>
    </div>
  );
};

export default OAuthCallback;