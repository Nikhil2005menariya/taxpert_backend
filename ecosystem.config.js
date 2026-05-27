module.exports = {
  apps: [
    { name: "api", script: "dist/index.js", instances: 1, env: { NODE_ENV: "production" } },
    { name: "worker", script: "dist/workers/index.js", instances: 1, env: { NODE_ENV: "production" } }
  ]
};
