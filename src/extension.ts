import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import WebSocket from 'ws';
import chokidar from 'chokidar';

let server: http.Server | undefined;
let wss: WebSocket.Server | undefined;
let statusBarButton: vscode.StatusBarItem;
let watchPaused = false;

function setServerContext(isRunning: boolean) {
  vscode.commands.executeCommand('setContext', 'pinsandcurves.serverRunning', isRunning);
}

export function activate(context: vscode.ExtensionContext) {
  // Create the status bar button

  setServerContext(false);
  // Register the toggle command
  const toggleCommand = vscode.commands.registerCommand('pinsandcurves.toggleServer', async () => {
    if (server) {
      stopWebServer();
      setServerContext(false);
    } else {
      startWebServer(context);
      setServerContext(true);
    }
  });
  context.subscriptions.push(toggleCommand);

}
async function startWebServer(context: vscode.ExtensionContext) {
  const port = 3000;
  const wsPort = 3001;

  const workspacePath = vscode.workspace.rootPath;
  if (!workspacePath) {
    vscode.window.showErrorMessage('No workspace folder is open.');
    return;
  }

  const jsonFilePath = path.join(workspacePath, 'project.pinsandcurves.json');
  const xmlFilePath = path.join(workspacePath, 'scene.pinsandcurves.xml');

  server = http.createServer((req, res) => {
    const reqUrl = req.url || '/';
    const method = req.method || 'GET';

    if (reqUrl === '/get-json' && method === 'GET') {
      // Handle /get-json endpoint
      if (!fs.existsSync(jsonFilePath)) {
        // Return 404 if the file does not exist
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File not found' }));
        return;
      }

      // Read the file and respond with its content
      const jsonData = fs.readFileSync(jsonFilePath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(jsonData);

    } else if (reqUrl === '/set-json' && method === 'POST') {
      // Handle /set-json endpoint
      let body = '';
      req.on('data', chunk => {

        body += chunk.toString();
      });

      req.on('end', () => {
        try {
          const jsonData = JSON.parse(body);
          fs.writeFileSync(jsonFilePath, JSON.stringify(jsonData, null, 2));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });

    } else if (reqUrl === '/set-xml' && method === 'POST') {
      // Handle /set-json endpoint


      let body = '';
      req.on('data', chunk => {

        body += chunk.toString();
      });

      req.on('end', () => {
        try {
          watchPaused = true;
          setTimeout(() => {
            watchPaused = false;
          }, 5000);
          fs.writeFileSync(xmlFilePath, body);
          res.writeHead(200, { 'Content-Type': 'text/xml' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          watchPaused = false;
          res.writeHead(400, { 'Content-Type': 'text/xml' });
          res.end(JSON.stringify({ error: 'Invalid XML' }));
        }
      });

    } else if (reqUrl === '/') {
      // Serve the HTML page as before
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Document</title>
            <script src="https://storage.googleapis.com/pinsandcurvesservice/PinsAndCurvesServer.umd.js" crossorigin="anonymous"></script>
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
        </head>
        <body>
        </body>
        </html>
      `);
    } else {
      // Serve other files dynamically from the workspace folder
      const filePath = path.join(workspacePath, reqUrl);
      fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('File not found');
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = getContentType(ext);

        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
      });
    }
  });

  server.listen(port, async () => {
    const serverUrl = `http://127.0.0.1:${port}/`;
    vscode.window.showInformationMessage(`Web server running at ${serverUrl}`);

    const open = await import('open');
    try {
      await open.default(serverUrl, { app: { name: 'google chrome' } });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to open Chrome: ${err.message}`);
    }
  });

  // Set up WebSocket server
  wss = new WebSocket.Server({ port: wsPort });
  vscode.window.showInformationMessage(`WebSocket server running at ws://127.0.0.1:${wsPort}/`);

  const filePathToWatch = workspacePath; // Watch the entire workspace folder

  // Exclude the JSON file from being watched
  const jsonFileName = path.basename(jsonFilePath);



  const watcher = chokidar.watch(filePathToWatch, {
    ignored: jsonFilePath, // Ignore the JSON file
    ignoreInitial: true,
  });

  watcher.on('change', (changedFilePath) => {
    if (watchPaused) { return; };
    console.log(`File changed: ${changedFilePath}`);
    if (path.basename(changedFilePath) === jsonFileName) {
      // Ignore changes to the JSON file
      return;
    }
    wss?.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send('refresh');
      }
    });
  });




  // fs.watch(filePathToWatch, { recursive: true }, (eventType, fileName) => {
  //   console.log("watch is pause?:",watchPaused);
  //   if (watchPaused) { return; }
  //   if (!fileName) { return; };

  //   const changedFilePath = path.join(filePathToWatch, fileName);

  //   if (path.basename(changedFilePath) === jsonFileName) {
  //     // Ignore changes to the JSON file
  //     return;
  //   }

  //   // Restart the server on any other file change
  //   console.log(`File changed: ${changedFilePath}. Restarting server...`);
  //   wss?.clients.forEach(client => {
  //     if (client.readyState === WebSocket.OPEN) {
  //       client.send('refresh'); // Notify all clients to refresh
  //     }
  //   });
  // });


}


// Stop the web server
function stopWebServer() {
  if (server) {
    server.close(() => {
      console.log('HTTP server has been stopped.');
      server = undefined;
    });
  }
  if (wss) {
    wss.close(() => {
      console.log('WebSocket server has been stopped.');
      wss = undefined;
    });
  }

  vscode.window.showInformationMessage('Web server stopped.');
}

export function deactivate() {
  // Clean up the server and WebSocket server when the extension is deactivated
  stopWebServer();
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


// Helper function to determine content type based on file extension
function getContentType(ext: string): string {
  switch (ext) {
    case '.html': return 'text/html';
    case '.js': return 'application/javascript';
    case '.css': return 'text/css';
    case '.png': return 'image/png';
    case '.jpg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.svg': return 'image/svg+xml';
    case '.json': return 'application/json';
    default: return 'application/octet-stream';
  }
}