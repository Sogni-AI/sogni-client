import { SogniClient } from './dist/index.js';
import { loadCredentials } from './examples/credentials.mjs';

async function test() {
  const { username, password } = await loadCredentials();
  const client = await SogniClient.createInstance();
  
  await client.account.login(username, password);
  console.log('Logged in');
  
  // Listen to all events
  client.projects.on('project', (event) => {
    console.log('PROJECT EVENT:', event.type, { projectId: event.projectId, jobId: event.jobId });
  });
  
  client.projects.on('job', (event) => {
    console.log('JOB EVENT:', event.type, { projectId: event.projectId, jobId: event.jobId });
  });
  
  // Create a simple project
  const project = await client.projects.create({
    type: 'image',
    modelId: 'z_image_turbo_bf16',
    positivePrompt: 'test',
    numberOfMedia: 1,
    steps: 1,
    tokenType: 'spark'
  });
  
  console.log('Created project:', project.id);
  
  // Wait a bit
  setTimeout(() => {
    console.log('Timeout reached');
    process.exit(0);
  }, 10000);
}

test().catch(console.error);
