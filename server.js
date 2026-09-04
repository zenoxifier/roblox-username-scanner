const express = require("express");

const app = express();

app.use(express.json({
    limit: "50kb"
}));

const PORT = process.env.PORT || 10000;

/* =========================================================
   SETTINGS
========================================================= */

const ROBLOX_VALIDATE_URL =
    "https://auth.roblox.com/v2/usernames/validate";

const MAX_BATCH = 50;
const CONCURRENCY = 8;
const MAX_RETRIES = 3;

/* =========================================================
   BACKEND RATE LIMIT
========================================================= */

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

/* =========================================================
   HOME
========================================================= */

app.get("/", (req, res) => {
    res.json({
        success: true,
        service: "Roblox Username Scanner Backend",
        status: "online"
    });
});

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", (req, res) => {
    res.json({
        ok: true
    });
});

/* =========================================================
   CHECK ONE USERNAME
========================================================= */

async function checkUsername(username) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const url =
                ROBLOX_VALIDATE_URL +
                "?request.username=" +
                encodeURIComponent(username) +
                "&request.birthday=2000-01-01" +
                "&request.context=Signup";

            const response = await fetch(url, {
                method: "GET",
                headers: {
                    Accept: "application/json"
                }
            });

            /* =================================================
               SUCCESS
            ================================================= */

            if (response.ok) {
                const data = await response.json();

                const code = Number(data.code);

                return {
                    username: username,
                    available: code === 0,
                    code: code,
                    message: data.message || ""
                };
            }

            /* =================================================
               RATE LIMITED
            ================================================= */

            if (response.status === 429) {
                const retryAfter =
                    response.headers.get("retry-after");

                let waitTime = 2000;

                if (retryAfter) {
                    const seconds = Number(retryAfter);

                    if (Number.isFinite(seconds)) {
                        waitTime = Math.max(
                            seconds * 1000,
                            1000
                        );
                    }
                } else {
                    waitTime = Math.min(
                        2000 * Math.pow(2, attempt),
                        10000
                    );
                }

                console.log(
                    `Rate limited: ${username}. Waiting ${waitTime}ms`
                );

                await new Promise(resolve =>
                    setTimeout(resolve, waitTime)
                );

                continue;
            }

            /* =================================================
               OTHER ERROR
            ================================================= */

            const text = await response.text();

            console.error(
                `Roblox error for ${username}:`,
                response.status,
                text
            );

            return {
                username: username,
                available: false,
                error: `Roblox HTTP ${response.status}`
            };
        } catch (error) {
            console.error(
                `Request failed for ${username}:`,
                error.message
            );

            if (attempt === MAX_RETRIES - 1) {
                return {
                    username: username,
                    available: false,
                    error: error.message
                };
            }

            const waitTime =
                1000 * Math.pow(2, attempt);

            await new Promise(resolve =>
                setTimeout(resolve, waitTime)
            );
        }
    }

    return {
        username: username,
        available: false,
        error: "Maximum retries reached."
    };
}

/* =========================================================
   CONCURRENT BATCH PROCESSOR
========================================================= */

async function checkBatch(usernames) {
    const results = new Array(usernames.length);

    let nextIndex = 0;

    async function worker() {
        while (true) {
            const index = nextIndex++;

            if (index >= usernames.length) {
                return;
            }

            const username = usernames[index];

            results[index] =
                await checkUsername(username);
        }
    }

    const workers = [];

    for (let i = 0; i < CONCURRENCY; i++) {
        workers.push(worker());
    }

    await Promise.all(workers);

    return results;
}

/* =========================================================
   BATCH ENDPOINT
========================================================= */

app.post(
    "/check-batch",
    rateLimit,
    async (req, res) => {
        try {
            let usernames = req.body?.usernames;

            /* =================================================
               VALIDATE ARRAY
            ================================================= */

            if (!Array.isArray(usernames)) {
                return res.status(400).json({
                    success: false,
                    error: "usernames must be an array."
                });
            }

            /* =================================================
               CLEAN USERNAMES
            ================================================= */

            usernames = [
                ...new Set(
                    usernames
                        .map(name =>
                            String(name).trim()
                        )
                        .filter(name =>
                            /^[A-Za-z][A-Za-z0-9]{2,19}$/.test(name)
                        )
                )
            ].slice(0, MAX_BATCH);

            if (usernames.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: "No valid usernames."
                });
            }

            console.log(
                `Checking ${usernames.length} usernames with ${CONCURRENCY} workers...`
            );

            /* =================================================
               CHECK USERNAMES
            ================================================= */

            const results =
                await checkBatch(usernames);

            /* =================================================
               SEND RESULTS
            ================================================= */

            return res.json({
                success: true,
                results: results
            });
        } catch (error) {
            console.error(
                "Batch error:",
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    error.message ||
                    "Batch request failed."
            });
        }
    }
);

/* =========================================================
   START SERVER
========================================================= */

app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            "======================================"
        );

        console.log(
            "ROBLOX USERNAME SCANNER BACKEND"
        );

        console.log(
            "======================================"
        );

        console.log(
            "Port:",
            PORT
        );

        console.log(
            "Concurrency:",
            CONCURRENCY
        );

        console.log(
            "Max batch:",
            MAX_BATCH
        );

        console.log(
            "Batch endpoint: /check-batch"
        );

        console.log(
            "======================================"
        );
    }
);
