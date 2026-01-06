module.exports = {
  apps: [
    {
      name: 'teketeke-api',
      script: 'server/server.js',
      cwd: '/home/teketeke/apps/teketeke-api',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 5001,
      },
    },
  ],
};
