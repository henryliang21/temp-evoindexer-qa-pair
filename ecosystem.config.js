module.exports = {
  apps: [
    {
      name: "evoindexer-qa-generator",
      script: "node_modules/.bin/next",
      args: "start -p 3001",
      cwd: "/opt/question-answer-generator",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      merge_logs: true,
      env: {
        NODE_ENV: "production",
        PORT: 3001,
      },
    },
  ],
};
