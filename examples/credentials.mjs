/**
 * Credential Management Utility for Sogni Examples
 *
 * This module handles loading credentials from .env file or prompting
 * the user to enter them interactively, with an option to save them.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { fileURLToPath } from 'node:url';

// Try to import dotenv, but handle gracefully if not installed
let dotenv;
try {
  dotenv = await import('dotenv');
} catch (error) {
  // dotenv not installed - will provide helpful error message later
  dotenv = null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_FILE = path.join(__dirname, '.env');

/**
 * Ask a question via readline
 */
function askQuestion(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Save credentials to .env file
 */
function saveCredentials(username, password, tokenType = null) {
  let envContent = `# Sogni Account Credentials
SOGNI_USERNAME=${username}
SOGNI_PASSWORD=${password}
`;

  if (tokenType) {
    envContent += `\n# Payment Token Type (sogni or spark)
SOGNI_TOKEN_TYPE=${tokenType}
`;
  }

  fs.writeFileSync(ENV_FILE, envContent, 'utf8');
  // Set restrictive permissions on the .env file
  try {
    fs.chmodSync(ENV_FILE, 0o600);
  } catch (e) {
    // Ignore errors on Windows
  }
}

/**
 * Update token type preference in .env file
 */
export function saveTokenTypePreference(tokenType) {
  if (!fs.existsSync(ENV_FILE)) {
    return;
  }

  let envContent = fs.readFileSync(ENV_FILE, 'utf8');
  
  // Check if TOKEN_TYPE already exists
  if (envContent.includes('SOGNI_TOKEN_TYPE=')) {
    // Update existing
    envContent = envContent.replace(
      /SOGNI_TOKEN_TYPE=.*/,
      `SOGNI_TOKEN_TYPE=${tokenType}`
    );
  } else {
    // Add new
    envContent += `\n# Payment Token Type (sogni or spark)
SOGNI_TOKEN_TYPE=${tokenType}
`;
  }

  fs.writeFileSync(ENV_FILE, envContent, 'utf8');
}

/**
 * Load token type preference from .env
 */
export function loadTokenTypePreference() {
  if (!dotenv || !fs.existsSync(ENV_FILE)) {
    return null;
  }

  dotenv.config({ path: ENV_FILE });
  const tokenType = process.env.SOGNI_TOKEN_TYPE;
  
  if (tokenType === 'sogni' || tokenType === 'spark') {
    return tokenType;
  }

  return null;
}

/**
 * Load credentials from .env or prompt user.
 * Returns { apiKey } if SOGNI_API_KEY is set, otherwise { username, password }.
 */
export async function loadCredentials() {
  // Check if dependencies are installed
  if (!dotenv) {
    console.error('❌ Error: Required dependencies not installed');
    console.error();
    console.error('Please run the following command in the examples directory:');
    console.error();
    console.error('  cd examples && npm install');
    console.error();
    console.error('This will install dotenv and other required packages.');
    console.error();
    process.exit(1);
  }

  // Load .env file if it exists
  if (fs.existsSync(ENV_FILE)) {
    dotenv.config({ path: ENV_FILE });
  }

  // Check for API key first (preferred auth method)
  const apiKey = process.env.SOGNI_API_KEY;
  if (apiKey) {
    console.log('✓ API key loaded from environment');
    console.log();
    return { apiKey };
  }

  // Try username/password from .env
  const username = process.env.SOGNI_USERNAME;
  const password = process.env.SOGNI_PASSWORD;

  if (username && password) {
    console.log('✓ Credentials loaded from .env file');
    console.log();
    return { username, password };
  }

  // .env file doesn't exist or credentials are missing
  console.log('═'.repeat(60));
  console.log('Sogni Account Credentials Required');
  console.log('═'.repeat(60));
  console.log();
  console.log('No credentials found in .env file.');
  console.log('Please enter your Sogni account credentials:');
  console.log('(Tip: set SOGNI_API_KEY in .env for API key auth)');
  console.log('(Get your API key at dashboard.sogni.ai → Username dropdown)');
  console.log();

  // Check if we're in a TTY (interactive terminal)
  if (!process.stdin.isTTY) {
    throw new Error(
      'No credentials found in .env file and running in non-interactive mode.\n' +
      'Please create a .env file in the examples directory with:\n' +
      'SOGNI_API_KEY=your_api_key\n' +
      'or:\n' +
      'SOGNI_USERNAME=your_username\n' +
      'SOGNI_PASSWORD=your_password'
    );
  }

  // Prompt for credentials
  const promptUsername = await askQuestion('Username: ');
  const promptPassword = await askQuestion('Password: ');

  if (!promptUsername || !promptPassword) {
    throw new Error('Username and password are required');
  }

  console.log();

  // Ask if they want to save credentials
  const save = await askQuestion('Save credentials to .env file? [Y/n]: ');

  if (save.toLowerCase() !== 'n' && save.toLowerCase() !== 'no') {
    saveCredentials(promptUsername, promptPassword);
    console.log(`✓ Credentials saved to: ${ENV_FILE}`);
    console.log('  (You won\'t need to enter them again)');
    console.log();
  } else {
    console.log('⚠️  Credentials not saved. You will need to enter them again next time.');
    console.log();
  }

  return { username: promptUsername, password: promptPassword };
}

