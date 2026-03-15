import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import mineflayer from "mineflayer";
import cors from "cors";

// In-memory storage (resets on server restart)
const claims: any[] = [];
const claimedIPs = new Set();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // Admin route to see answers (Hidden)
  app.get("/api/admin/applications", (req, res) => {
    res.json(claims);
  });

  // API Route to claim rank via Minecraft Bot
  app.post("/api/claim-rank", async (req, res) => {
    const { username, mafiaPlan, ip } = req.body;
    const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (claimedIPs.has(clientIP)) {
      return res.status(403).json({ 
        error: "Security Alert", 
        details: "You have already claimed a rank from this connection. One claim per person!" 
      });
    }

    if (!username || username.length < 3 || username.length > 16) {
      return res.status(400).json({ error: "Invalid Username", details: "Minecraft usernames must be between 3 and 16 characters." });
    }

    // Basic anti-scam: check for suspicious patterns
    const suspiciousPatterns = [/admin/i, /staff/i, /owner/i, /moderator/i];
    if (suspiciousPatterns.some(p => p.test(username))) {
      return res.status(403).json({ error: "Security Alert", details: "This username is restricted for security reasons." });
    }

    // Save the application info for the admin
    claims.push({
      username,
      mafiaPlan,
      ip: clientIP,
      timestamp: new Date().toISOString()
    });

    const SERVER_HOST = "FilmsCrazy.aternos.me";
    const SERVER_PORT = 61443;

    console.log(`Starting bot to give rank to ${username}...`);

    try {
      console.log(`Attempting to connect bot to ${SERVER_HOST}:${SERVER_PORT}...`);
      
      const bot = mineflayer.createBot({
        host: SERVER_HOST,
        port: SERVER_PORT,
        username: "MissionRewardBot",
        // version: "1.20.1", // If auto-detect fails, we might need to hardcode this
        hideErrors: false,
        checkTimeoutInterval: 60000, // Increased timeout
      });

      let responseSent = false;

      // Helper to close bot and respond
      const finish = (status: number, body: any) => {
        if (responseSent) return;
        responseSent = true;
        try {
          bot.end();
        } catch (e) {
          console.error("Error ending bot:", e);
        }
        res.status(status).json(body);
      };

      bot.on("login", () => {
        console.log("Bot logged in successfully.");
      });

      bot.on("spawn", () => {
        console.log("Bot spawned in world.");
        
        // AuthMe support: Try to register and login
        const botPassword = "MissionBotPassword123";
        bot.chat(`/register ${botPassword} ${botPassword}`);
        setTimeout(() => {
          bot.chat(`/login ${botPassword}`);
        }, 1000);

        // Wait a bit for the server to process the join and login
        setTimeout(() => {
          const command = `/lp user ${username} parent set mafia`;
          bot.chat(command);
          console.log(`Sent command for ${username}: ${command}`);

          // Wait for chat to send before quitting
          setTimeout(() => {
            claimedIPs.add(clientIP); // Mark IP as used on success
            finish(200, { success: true, message: "Rank assigned successfully!" });
          }, 2000);
        }, 6000); // Increased wait time for AuthMe
      });

      bot.on("kicked", (reason) => {
        const reasonText = typeof reason === 'string' ? reason : JSON.stringify(reason);
        console.warn("Bot was kicked:", reasonText);
        
        let friendlyMessage = "The server kicked the bot.";
        if (reasonText.includes("Online Mode")) {
          friendlyMessage = "Server is in 'Online Mode'. Please enable 'Cracked' in Aternos settings.";
        } else if (reasonText.includes("whitelist")) {
          friendlyMessage = "Bot is not whitelisted. Please add 'MissionRewardBot' to whitelist.";
        }

        finish(500, { 
          error: "Bot kicked.", 
          details: friendlyMessage,
          raw: reasonText 
        });
      });

      bot.on("error", (err: any) => {
        console.error("Bot Error Event:", err);
        
        if (err.code === 'ECONNRESET') {
          finish(500, { 
            error: "Connection Reset (ECONNRESET).", 
            details: "The Minecraft server closed the connection. Check if 'Cracked' is ON and the version is correct (1.20.1 recommended)."
          });
        } else if (err.code === 'ETIMEDOUT') {
          finish(500, { 
            error: "Connection Timeout.", 
            details: "Could not reach the Minecraft server. Is it online?"
          });
        } else {
          finish(500, { error: "Bot connection error.", details: err.message || "Unknown error" });
        }
      });

      bot.on("end", () => {
        console.log("Bot connection ended.");
        if (!responseSent) {
          finish(500, { error: "Connection Closed", details: "The bot disconnected before completing the mission." });
        }
      });

      // Global timeout
      setTimeout(() => {
        if (!responseSent) {
          console.error("Bot connection timed out after 45s");
          finish(500, { error: "Timeout", details: "The server is taking too long to respond. Is it online and joinable?" });
        }
      }, 45000);

    } catch (error: any) {
      console.error("Critical Bot Error:", error);
      res.status(500).json({ error: "Internal server error.", details: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
