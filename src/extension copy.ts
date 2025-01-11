import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import WebSocket from 'ws';

let server: http.Server | undefined;
let wss: WebSocket.Server | undefined;

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand('pinsandcurves.startWebServer', async () => {
    const port = 3000;
    const wsPort = 3001;
    // Find the first top-level file ending with pinsandcurves.xml
    const workspacePath = vscode.workspace.rootPath;
    if (!workspacePath) {
      vscode.window.showErrorMessage('No workspace folder is open.');
      return;
    }

    const filePathToWatch = findPinsAndCurvesFile(workspacePath);
    if (!filePathToWatch) {
      vscode.window.showErrorMessage('No file ending with pinsandcurves.xml found at the top level of the workspace.');
      return;
    }

    // Create a simple HTTP server
    server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <body>
            <h1>Live Reload Example</h1>
            <script>
				console.log('Connecting to WebSocket server...');
              const socket = new WebSocket('ws://127.0.0.1:${wsPort}');
              socket.onmessage = (event) => {
                if (event.data === 'refresh') {
                  console.log('File changed, refreshing...');
                  location.reload();
                }
              };
            </script>
          </body>
          </html>
        `);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    server.listen(port, async () => {
		const serverUrl = `http://127.0.0.1:${port}/`;
      vscode.window.showInformationMessage(`Web server running at http://127.0.0.1:${port}/`);

	  const open = await import('open');

	  try {
        // Open the URL in Chrome
        await open.default(serverUrl, { app: { name: 'google chrome' } });
      } catch (err : any) {
        vscode.window.showErrorMessage(`Failed to open Chrome: ${err.message}`);
      }
    });

    // Set up WebSocket server
    wss = new WebSocket.Server({ port: wsPort });
    vscode.window.showInformationMessage(`WebSocket server running at ws://127.0.0.1:${wsPort}/`);

    // Watch the specified file
    if (fs.existsSync(filePathToWatch)) {
      fs.watch(filePathToWatch, () => {
        console.log(`File changed: ${filePathToWatch}`);
        wss?.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send('refresh'); // Notify all clients to refresh
          }
        });
      });
    } else {
      vscode.window.showWarningMessage(`File to watch does not exist: ${filePathToWatch}`);
    }

    server.on('error', (err) => {
      vscode.window.showErrorMessage(`Server error: ${err.message}`);
    });
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {
  // Clean up the server and WebSocket server when the extension is deactivated
  if (server) {
    server.close(() => {
      console.log('HTTP server has been stopped.');
    });
    server = undefined;
  }
  if (wss) {
    wss.close(() => {
      console.log('WebSocket server has been stopped.');
    });
    wss = undefined;
  }
}


// Helper function to find the first top-level file ending with pinsandcurves.xml
function findPinsAndCurvesFile(workspacePath: string): string | null {
	const files = fs.readdirSync(workspacePath, { withFileTypes: true });
	for (const file of files) {
	  if (file.isFile() && file.name.endsWith('pinsandcurves.xml')) {
		return path.join(workspacePath, file.name);
	  }
	}
	return null;
  }