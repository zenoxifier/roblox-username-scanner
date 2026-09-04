const express = require("express");

const app = express();

app.use(express.json({
    limit: "50kb"
}));

const PORT = process.env.PORT || 10000;

const ROBLOX_URL =
    "https://users.roblox.com/v1/usernames/users";

const MAX_BATCH = 50;

const MAX_RETRIES = 5;


/* =========================================
   RATE LIMIT
========================================= */

const requests = new Map();

const WINDOW_MS = 60 * 1000;

const MAX_REQUESTS_PER_IP = 300;


function rateLimit(req, res, next) {

    const ip =
        req.headers["x-forwarded-for"]
            ?.split(",")[0]
            ?.trim() ||
        req.socket.remoteAddress ||
        "unknown";

    const now = Date.now();

    let entry = requests.get(ip);

    if (
        !entry ||
        now - entry.start > WINDOW_MS
    ) {

        entry = {
            start: now,
            count: 0
        };

    }

    entry.count++;

    requests.set(ip, entry);

    if (
        entry.count >
        MAX_REQUESTS_PER_IP
    ) {

        return res.status(429).json({

            success: false,

            error:
                "Backend rate limit reached."

        });

    }

    next();
}


/* =========================================
   HOME
========================================= */

app.get("/", (req, res) => {

    res.json({

        success: true,

        service:
            "Roblox Username Scanner Backend",

        status: "online"

    });

});


/* =========================================
   HEALTH
========================================= */

app.get("/health", (req, res) => {

    res.json({

        ok: true

    });

});


/* =========================================
   ROBLOX API
========================================= */

async function checkRoblox(usernames) {

    for (
        let attempt = 0;
        attempt < MAX_RETRIES;
        attempt++
    ) {

        try {

            const response =
                await fetch(
                    ROBLOX_URL,
                    {

                        method: "POST",

                        headers: {

                            "Content-Type":
                                "application/json",

                            "Accept":
                                "application/json"

                        },

                        body: JSON.stringify({

                            usernames:
                                usernames,

                            excludeBannedUsers:
                                false

                        })

                    }
                );


            /* =================================
               SUCCESS
            ================================= */

            if (response.ok) {

                return await response.json();

            }


            /* =================================
               RATE LIMITED
            ================================= */

            if (
                response.status === 429
            ) {

                const retryAfter =
                    response.headers.get(
                        "retry-after"
                    );

                let waitTime;

                if (retryAfter) {

                    const seconds =
                        Number(retryAfter);

                    if (
                        Number.isFinite(seconds)
                    ) {

                        waitTime =
                            seconds * 1000;

                    }

                }

                if (!waitTime) {

                    waitTime =
                        Math.min(
                            1000 *
                            Math.pow(
                                2,
                                attempt
                            ),
                            15000
                        );

                }

                console.log(
                    `Roblox returned 429. Waiting ${waitTime}ms...`
                );

                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            waitTime
                        )
                );

                continue;

            }


            /* =================================
               OTHER ROBLOX ERROR
            ================================= */

            const errorText =
                await response.text();

            console.error(
                "Roblox API error:",
                response.status,
                errorText
            );

            throw new Error(
                `Roblox API returned ${response.status}: ${errorText}`
            );

        }
        catch (error) {

            console.error(
                "Roblox request error:",
                error.message
            );

            if (
                attempt ===
                MAX_RETRIES - 1
            ) {

                throw error;

            }

            const waitTime =
                Math.min(
                    1000 *
                    Math.pow(
                        2,
                        attempt
                    ),
                    15000
                );

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        waitTime
                    )
            );

        }

    }

    throw new Error(
        "Roblox API failed after retries."
    );

}


/* =========================================
   BATCH CHECK
========================================= */

app.post(
    "/check-batch",
    rateLimit,
    async (req, res) => {

        try {

            let usernames =
                req.body?.usernames;


            /* =================================
               VALIDATE
            ================================= */

            if (
                !Array.isArray(usernames)
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "usernames must be an array."

                });

            }


            /* =================================
               CLEAN
            ================================= */

            usernames =
                [
                    ...new Set(

                        usernames
                            .map(
                                name =>
                                    String(name)
                                        .trim()
                            )

                            .filter(
                                name =>
                                    /^[A-Za-z][A-Za-z0-9]{2,19}$/
                                        .test(name)
                            )

                    )
                ]
                .slice(
                    0,
                    MAX_BATCH
                );


            if (
                usernames.length === 0
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "No valid usernames."

                });

            }


            console.log(
                `Checking ${usernames.length} usernames...`
            );


            /* =================================
               CHECK ROBLOX
            ================================= */

            const data =
                await checkRoblox(
                    usernames
                );


            /* =================================
               EXISTING USERS
            ================================= */

            const existing =
                new Set();


            if (
                Array.isArray(data.data)
            ) {

                for (
                    const user
                    of data.data
                ) {

                    if (user.name) {

                        existing.add(
                            user.name
                                .toLowerCase()
                        );

                    }

                }

            }


            /* =================================
               CREATE RESULTS
            ================================= */

            const results =
                usernames.map(
                    username => ({

                        username:
                            username,

                        available:
                            !existing.has(
                                username
                                    .toLowerCase()
                            )

                    })
                );


            /* =================================
               RESPONSE
            ================================= */

            return res.json({

                success: true,

                results:
                    results

            });

        }
        catch (error) {

            console.error(
                "Batch error:",
                error
            );

            return res.status(502).json({

                success: false,

                error:
                    error.message ||
                    "Roblox API request failed."

            });

        }

    }
);


/* =========================================
   START SERVER
========================================= */

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Username backend running on port ${PORT}`
        );

    }
);
