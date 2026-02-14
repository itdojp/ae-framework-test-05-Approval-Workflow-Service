import { createApp } from './api/app.js';
import { ApprovalEngine } from './domain/engine.js';

const engine = new ApprovalEngine();
const app = createApp(engine);
const port = Number(process.env['PORT'] || 3000);

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`approval-workflow-service listening on :${port}`);
});

