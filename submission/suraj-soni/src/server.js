const { createApp } = require("./app");
const { app } = createApp();
const port = Number(process.env.PORT || 4177);
app.listen(port, "127.0.0.1", () => {
  console.log(`Subscription & Billing test fixture listening on http://127.0.0.1:${port}`);
});