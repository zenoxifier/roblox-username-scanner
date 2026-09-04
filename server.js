const express = require("express");

const app = express();

app.use(express.json({
    limit: "50kb"
}));

const PORT = process.env.PORT || 10000;


/* =========================
   ROBLOX API SETTINGS
========================= */

const ROBLOX_URL =
    "https://users.roblox.com/v1/usernames/users";

const MAX_BATCH = 50;

const MAX_RETRIES = 4;


/* =========================
   BACKEND RATE LIMIT
========================= */

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
            error: "Backend rate limit reached."
        });

    }

    next();
}


/* =========================
   HOME
========================= */

app.get("/", (req, res) => {

    res.json({
        success: true,
        service: "Roblox Username Scanner Backend",
        status: "online"
    });

});


/* =========================
   HEALTH
========================= */

app.get("/health", (req, res) => {

    res.json({
        ok: true
    });

});


/* =========================
   ROBLOX CHECK
========================= */

async function checkRoblox(usernames) {

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {

        try {

            const response = await fetch(
                ROBLOX_URL,
                {
                    method: "POST",

                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },

                    body: JSON.stringify({
                        usernames: usernames,
                        excludeBannedUsers: false
                    })
                }
            );


            /* =========================
               SUCCESS
            ========================= */

            if (response.ok) {

                return await response.json();

            }


            /* =========================
               RATE LIMITED
            ========================= */

            if (response.status === 429) {

                const retryAfter =
                    response.headers.get("retry-after");

                let waitTime =
                    retryAfter
                        ? Number(retryAfter) * 1000
                        : Math.min(
                            1000 * Math.pow(2, attempt),
                            10000
                        );

                console.log(
                    `Roblox rate limited request. Waiting ${waitTime}ms...`
                );

                await new Promise(resolve =>
                    setTimeout(resolve, waitTime)
                );

                continue;

            }


            /* =========================
               OTHER ERROR
            ========================= */

            const errorText =
                await response.text();

            console.error(
                "Roblox API error:",
                response.status,
                errorText
            );

            throw new Error(
                `Roblox API returned ${response.status}`
            );

        } catch (error) {

            console.error(
                "Roblox request failed:",
                error.message
            );

            if (attempt === MAX_RETRIES - 1) {
                throw error;
            }

            const waitTime =
                Math.min(
                    1000 * Math.pow(2, attempt),
                    10000
                );

            await new Promise(resolve =>
                setTimeout(resolve, waitTime)
            );

        }

    }

    throw new Error(
        "Roblox API failed after retries."
    );

}


/* =========================
   BATCH CHECK
========================= */

app.post(
    "/check-batch",
    rateLimit,
    async (req, res) => {

        try {

            let usernames =
                req.body?.usernames;


            /* =========================
               VALIDATE ARRAY
            ========================= */

            if (!Array.isArray(usernames)) {

                return res.status(400).json({
                    success: false,
                    error: "usernames must be an array."
                });

            }


            /* =========================
               CLEAN USERNAMES
            ========================= */

            usernames =
                [...new Set(
                    usernames
                        .map(name =>
                            String(name).trim()
                        )
                        .filter(name =>
                            /^[A-Za-z][A-Za-z0-9]{2,19}$/
                                .test(name)
                        )
                )]
                .slice(0, MAX_BATCH);


            if (usernames.length === 0) {

                return res.status(400).json({
                    success: false,
                    error: "No valid usernames."
                });

            }


            console.log(
                `Checking ${usernames.length} usernames...`
            );


            /* =========================
               ASK ROBLOX
            ========================= */

            const data =
                await checkRoblox(usernames);


            /* =========================
               FIND EXISTING USERS
            ========================= */

            const existing =
                new Set();

            if (Array.isArray(data.data)) {

                for (const user of data.data) {

                    if (user.name) {

                        existing.add(
                            user.name.toLowerCase()
                        );

                    }

                }

            }


            /* =========================
               BUILD RESULTS
            ========================= */

            const results =
                usernames.map(username => {

                    return {

                        username: username,

                        available:
                            !existing.has(
                                username.toLowerCase()
                            )

                    };

                });


            /* =========================
               SEND RESULT
            ========================= */

            res.json({

                success: true,

                results: results

            });


        } catch (error) {

            console.error(
                "Batch error:",
                error
            );

            res.status(502).json({

                success: false,

                error:
                    error.message ||
                    "Roblox API request failed."

            });

        }

    }
);


/* =========================
   SERVER
========================= */

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Username backend running on port ${PORT}`
        );

    }
);
