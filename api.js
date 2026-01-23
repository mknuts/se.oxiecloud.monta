module.exports = {
  async 'test-connection'({ homey, body }) {
    try {
      const { username, password } = body;
      
      // We use the API instance to test the credentials
      const url = 'https://public-api.monta.com/api/v1/auth/token';
      const result = await homey.app.api.authenticate(url, {
        clientId: username,
        clientSecret: password
      });

      if (result) {
        return { success: true };
      }
    } catch (error) {
      // Return error to the HTML setting page
      return { success: false, message: error.message };
    }
  },
};