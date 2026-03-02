# Sample integration of Sogni with Express.js application

This example demonstrates how to integrate the Sogni SDK with an Express.js application.

## Prerequisites

- Node.js 20 or later
- npm or yarn package manager
- A Sogni API account and credentials

## Installation

1. Clone this repository
2. Navigate to the example directory:
   ```bash
   cd examples/express
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

## Configuration

Edit `index.js` file and udpate followind lines with your real credentials and App ID:
```js
const USERNAME = 'your-username';
const PASSWORD = 'your-password';
const APP_ID = 'your-app-id';
```
**Important:** You should never store credentials in code in real production applications. This is for demo purposes only. 

## Running the Example

1. Start the server:
   ```bash
   npm start
   ```
2. The server will be available at `http://localhost:3000`

## Example Overview

This example demonstrates:

- Setting up Sogni client in Express.js middleware
- Handling authentication
- Basic API endpoints integration
- Error handling
