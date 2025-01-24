import { useEffect } from 'react';
import { handleOAuthCallback } from '../lib/auth';
import { SESSION_KEYS } from '../lib/constants';

const OAuthCallback = () => {
  useEffect(() => {
    const handleCallback = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const serverUrl = sessionStorage.getItem(SESSION_KEYS.SERVER_URL);

      if (!code || !serverUrl) {
        console.error('Missing code or server URL');
        window.location.href = '/';
        return;
      }

      try {
        const accessToken = await handleOAuthCallback(serverUrl, code);
        // Store the access token for future use
        sessionStorage.setItem(SESSION_KEYS.ACCESS_TOKEN, accessToken);
        // Redirect back to the main app with server URL to trigger auto-connect
        window.location.href = `/?serverUrl=${encodeURIComponent(serverUrl)}`;
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