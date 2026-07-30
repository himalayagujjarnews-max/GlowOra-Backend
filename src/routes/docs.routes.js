/**
 * API docs — serves the OpenAPI JSON and a Swagger UI page (loaded from CDN,
 * so no extra npm dependency is required). Public, read-only.
 */
const express = require('express');
const openapi = require('../docs/openapi');

const router = express.Router();

// machine-readable spec
router.get('/docs.json', (req, res) => res.json(openapi));

// Swagger UI (CDN)
router.get('/docs', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>GlowOra API Docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/api/v1/docs.json',
        dom_id: '#swagger',
        presets: [SwaggerUIBundle.presets.apis],
        layout: 'BaseLayout',
      });
    };
  </script>
</body>
</html>`);
});

module.exports = router;
