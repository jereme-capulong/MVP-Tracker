import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from "electron";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";

let mainWindow: BrowserWindow | null = null;
const IMPORT_CSV_CHANNEL = "monsters:import-csv";
const PICK_ALERT_SOUND_FILE_CHANNEL = "settings:pick-alert-sound-file";
const GOOGLE_OAUTH_SIGN_IN_CHANNEL = "auth:google-oauth-sign-in";
const GOOGLE_AUTH_TIMEOUT_MS = 3 * 60 * 1000;
const GOOGLE_AUTH_SCOPE = "openid email profile";

function resolveWindowIconPath(): string | undefined {
  if (process.platform !== "win32") {
    return undefined;
  }

  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, "icon.ico")
    : path.join(app.getAppPath(), "build", "icon.ico");

  return existsSync(candidate) ? candidate : undefined;
}

type GoogleOauthTokens = {
  idToken: string;
  accessToken: string;
};

type GoogleTokenResponse = {
  access_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

function toBase64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = toBase64Url(randomBytes(64));
  const challenge = toBase64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function createState(): string {
  return toBase64Url(randomBytes(32));
}

function createAuthCallbackPage(isSuccess: boolean, detail: string): string {
  const title = isSuccess ? "Sign-In Complete" : "Sign-In Failed";
  const safeDetail = detail.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body { margin: 0; padding: 24px; font-family: Segoe UI, Arial, sans-serif; background: #0f131a; color: #e7edf7; }
      .panel { max-width: 560px; margin: 0 auto; border: 1px solid #2a313c; border-radius: 10px; padding: 16px; background: #171b22; }
      h1 { margin: 0 0 10px; font-size: 20px; }
      p { margin: 0; color: #b8c4d4; }
    </style>
  </head>
  <body>
    <div class="panel">
      <h1>${title}</h1>
      <p>${safeDetail}</p>
    </div>
  </body>
</html>`;
}

async function exchangeGoogleCodeForTokens(input: {
  clientId: string;
  clientSecret?: string | null;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<GoogleOauthTokens> {
  const body = new URLSearchParams();
  body.set("client_id", input.clientId);
  body.set("code", input.code);
  body.set("code_verifier", input.codeVerifier);
  body.set("grant_type", "authorization_code");
  body.set("redirect_uri", input.redirectUri);
  if (input.clientSecret) {
    body.set("client_secret", input.clientSecret);
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const tokenResponse = (await response.json()) as GoogleTokenResponse;
  if (!response.ok) {
    const detail =
      tokenResponse.error_description ??
      tokenResponse.error ??
      `Google token exchange failed with HTTP ${response.status}.`;
    throw new Error(detail);
  }

  if (!tokenResponse.id_token || !tokenResponse.access_token) {
    throw new Error("Google token exchange did not return required tokens.");
  }

  return {
    idToken: tokenResponse.id_token,
    accessToken: tokenResponse.access_token,
  };
}

async function runGoogleDesktopOauth(clientId: string, clientSecret?: string | null): Promise<GoogleOauthTokens> {
  const normalizedClientId = clientId.trim();
  if (!normalizedClientId) {
    throw new Error("Google OAuth client ID is missing.");
  }
  const normalizedClientSecret = clientSecret?.trim() || null;

  const state = createState();
  const { verifier, challenge } = createPkcePair();

  const authorizationCode = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    let isFinished = false;
    let redirectUri = "";
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const finish = (next: () => void) => {
      if (isFinished) {
        return;
      }
      isFinished = true;
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      if (server.listening) {
        server.close(() => {
          next();
        });
        return;
      }
      next();
    };

    const fail = (error: unknown) => {
      const normalizedError = error instanceof Error ? error : new Error("Google sign-in failed.");
      finish(() => reject(normalizedError));
    };

    const server = createServer((request, response) => {
      const requestPath = request.url ?? "/";
      const requestUrl = new URL(requestPath, "http://127.0.0.1");
      if (requestUrl.pathname !== "/oauth/callback") {
        response.statusCode = 404;
        response.end("Not Found");
        return;
      }

      const returnedState = requestUrl.searchParams.get("state");
      if (returnedState !== state) {
        response.statusCode = 400;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(createAuthCallbackPage(false, "Invalid sign-in state. You can close this tab."));
        fail(new Error("Google sign-in state validation failed."));
        return;
      }

      const oauthError = requestUrl.searchParams.get("error");
      if (oauthError) {
        const oauthDescription =
          requestUrl.searchParams.get("error_description") ?? "Google sign-in was cancelled.";
        response.statusCode = 400;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(createAuthCallbackPage(false, oauthDescription));
        fail(new Error(`${oauthError}: ${oauthDescription}`));
        return;
      }

      const code = requestUrl.searchParams.get("code");
      if (!code) {
        response.statusCode = 400;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(createAuthCallbackPage(false, "Missing authorization code. You can close this tab."));
        fail(new Error("Google sign-in callback did not include an authorization code."));
        return;
      }

      response.statusCode = 200;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(createAuthCallbackPage(true, "You can return to MVP Tracker now."));

      finish(() => resolve({ code, redirectUri }));
    });

    server.on("error", (error) => {
      fail(error);
    });

    timeoutHandle = setTimeout(() => {
      fail(new Error("Timed out waiting for Google sign-in completion."));
    }, GOOGLE_AUTH_TIMEOUT_MS);

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        fail(new Error("Failed to start local OAuth callback server."));
        return;
      }

      redirectUri = `http://127.0.0.1:${address.port}/oauth/callback`;
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", normalizedClientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", GOOGLE_AUTH_SCOPE);
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("code_challenge", challenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "select_account");

      shell
        .openExternal(authUrl.toString())
        .then(() => {})
        .catch((error) => {
          fail(error);
        });
    });
  });

  return exchangeGoogleCodeForTokens({
    clientId: normalizedClientId,
    clientSecret: normalizedClientSecret,
    code: authorizationCode.code,
    codeVerifier: verifier,
    redirectUri: authorizationCode.redirectUri,
  });
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 300,
    minHeight: 640,
    resizable: true,
    backgroundColor: "#121418",
    autoHideMenuBar: true,
    icon: resolveWindowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Renderer is served by Vite in dev and loaded from static build output in prod.
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  ipcMain.handle(IMPORT_CSV_CHANNEL, async () => {
    const ownerWindow = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
    const openDialogOptions: OpenDialogOptions = {
      title: "Import Monster CSV",
      filters: [{ name: "CSV Files", extensions: ["csv"] }],
      properties: ["openFile"],
    };
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, openDialogOptions)
      : await dialog.showOpenDialog(openDialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    try {
      return await readFile(result.filePaths[0], "utf8");
    } catch {
      return null;
    }
  });

  ipcMain.handle(PICK_ALERT_SOUND_FILE_CHANNEL, async () => {
    const ownerWindow = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
    const openDialogOptions: OpenDialogOptions = {
      title: "Select Alert Sound",
      filters: [{ name: "Audio Files", extensions: ["mp3", "wav", "ogg"] }],
      properties: ["openFile"],
    };
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, openDialogOptions)
      : await dialog.showOpenDialog(openDialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0] ?? null;
  });

  ipcMain.handle(
    GOOGLE_OAUTH_SIGN_IN_CHANNEL,
    async (_event, clientId: unknown, clientSecret: unknown) => {
      if (typeof clientId !== "string") {
        throw new Error("Invalid Google OAuth client ID.");
      }
      if (clientSecret !== undefined && clientSecret !== null && typeof clientSecret !== "string") {
        throw new Error("Invalid Google OAuth client secret.");
      }

      return runGoogleDesktopOauth(clientId, clientSecret ?? null);
    }
  );

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
