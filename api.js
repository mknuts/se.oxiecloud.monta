module.exports = {
  async 'test-connection'({ homey, body }) {
    try {
      const { username, password } = body;
      
      // Vi använder API-instansen i app.js för att testa inloggningen
      const url = 'https://public-api.monta.com/api/v1/auth/token';
      const result = await homey.app.api.authenticate(url, {
        clientId: username,
        clientSecret: password
      });

      if (result) {
        return { success: true };
      }
    } catch (error) {
      // Returnera felet så att HTML-sidan kan visa det
      return { success: false, message: error.message };
    }
  },
};