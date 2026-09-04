const express = require("express");

const app = express();
app.use(express.json({ limit: "10kb" }));

const PORT = process.env.PORT || 10000;

// Simple in-memory rate limit.
// Render instances have ephemeral memory, so this is intentionally basic.
const requests = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_IP = 500;

function rateLimit(req, res, next) {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    const now = Date.now();

    let entry = requests.get(ip);

    if (!entry || now - entry.start > WINDOW_MS) {
        entry = { start: now, count: 0 };
    }

    entry.count++;
    requests.set(ip, entry);

    if (entry.count > MAX_REQUESTS_PER_IP) {
        return res.status(429).json({
            success: false,
            error: "Too many requests. Please slow down."
        });
    }

    next();
}

app.get("/", (req, res) => {
    res.json({
        success: true,
        service: "Roblox Username Scanner Backend",
        status: "online"
    });
});

app.get("/health", (req, res) => {
    res.json({ ok: true });
});

app.post("/check", rateLimit, async (req, res) => {
    try {
        const username = String(req.body?.username || "").trim();

        // Only allow the same safe character set the Roblox game generates.
        if (!/^[A-Za-z][A-Za-z0-9]{2,19}$/.test(username)) {
            return res.status(400).json({
                success: false,
                error: "Invalid username format."
            });
        }

        const robloxResponse = await fetch(
            "https://users.roblox.com/v1/usernames/users",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    usernames: [username],
                    excludeBannedUsers: false
                })
            }
        );

        if (!robloxResponse.ok) {
            const text = await robloxResponse.text();
            console.error("Roblox API error:", robloxResponse.status, text);

            return res.status(502).json({
                success: false,
                error: `Roblox API returned ${robloxResponse.status}.`
            });
        }

        const data = await robloxResponse.json();

        const exists = Array.isArray(data.data) && data.data.length > 0;

        res.json({
            success: true,
            available: !exists,
            username
        });

    } catch (error) {
        console.error("Backend error:", error);

        res.status(500).json({
            success: false,
            error: "Backend request failed."
        });
    }
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Username backend running on port ${PORT}`);
});
