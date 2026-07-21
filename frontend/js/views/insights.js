// views/insights.js — redirects to dashboard (now home of all analytics)

async function renderInsights(main) {
  // Insights content has moved to the Dashboard view
  window.location.hash = '#/insights';
  await renderDashboard(main);
}

// /insights already registered in dashboard.js; this file is kept for safety
// Router.register('/insights', renderInsights);
