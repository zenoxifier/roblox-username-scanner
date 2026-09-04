const express = require("express");

const app = express();
app.use(express.json({ limit: "50kb" }));

const PORT = process.env.PORT || 10000;

const requests = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_IP = 300;

function rateLimit(req, res, next) {
    const ip =
        req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req.socket.remoteAddress ||
        "unknown";

    const now = Date.now();

    let entry = requests.get(ip);

    if (!entry || now - entry.start > WINDOW_MS) {
        entry = {
            start: now,
            count: 0
        };
    }

    entry.count++;
    requests.set(ip, entry);

    if (entry.count > MAX_REQUESTS_PER_IP) {
        return res.status(429).json({
            success: false,
            error: "Too many requests."
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


/*
    SINGLE USERNAME CHECK
*/
app.post("/check", rateLimit, async (req, res) => {
    try {
        const username = String(req.body?.username || "").trim();

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
            return res.status(502).json({
                success: false,
                error: `Roblox API returned ${robloxResponse.status}.`
            });
        }

        const data = await robloxResponse.json();

        const exists =
            Array.isArray(data.data) &&
            data.data.length > 0;

        res.json({
            success: true,
            available: !exists,
            username: username
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            error: "Backend request failed."
        });
    }
});


/*
    BATCH USERNAME CHECK
    Up to 50 usernames per request
*/
app.post("/check-batch", rateLimit, async (req, res) => {
    try {
        let usernames = req.body?.usernames;

        if (!Array.isArray(usernames)) {
            return res.status(400).json({
                success: false,
                error: "usernames must be an array."
            });
        }

        usernames = usernames
            .map(name => String(name).trim())
            .filter(name =>
                /^[A-Za-z][A-Za-z0-9]{2,19}$/.test(name)
            )
            .slice(0, 50);

        if (usernames.length === 0) {
            return res.status(400).json({
                success: false,
                error: "No valid usernames."
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
                    usernames: usernames,
                    excludeBannedUsers: false
                })
            }
        );

        if (!robloxResponse.ok) {
            const text = await robloxResponse.text();

            console.error(
                "Roblox API error:",
                robloxResponse.status,
                text
            );

            return res.status(502).json({
                success: false,
                error: `Roblox API returned ${robloxResponse.status}.`
            });
        }

        const data = await robloxResponse.json();

        const found = new Set();

        if (Array.isArray(data.data)) {
            for (const user of data.data) {
                if (user.name) {
                    found.add(user.name.toLowerCase());
                }
            }
        }

        const results = usernames.map(username => ({
            username: username,
            available: !found.has(username.toLowerCase())
        }));

        res.json({
            success: true,
            results: results
        });

    } catch (error) {
        console.error("Batch error:", error);

        res.status(500).json({
            success: false,
            error: "Batch request failed."
        });
    }
});


app.listen(PORT, "0.0.0.0", () => {
    console.log(
        `Username backend running on port ${PORT}`
    );
});
