module.exports = {
  apps: [
    {
      name: 'teketeke-api',
      script: 'server/server.js',
      cwd: process.cwd(),
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 5001,
      },
    },
  ],
};
