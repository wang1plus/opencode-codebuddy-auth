/**
 * Shared RPC contract between the server plugin (which owns the OAuth
 * credential) and the TUI plugin (which only has a client connection).
 */
export const creditsRpc = {
    id: "codebuddy-auth",
    methods: {
        credits: {
            input: {
                type: "object",
                properties: {},
                additionalProperties: false,
            },
            output: {
                type: "object",
                properties: {
                    ok: { type: "boolean" },
                    totalRemain: { type: "number" },
                    totalUsed: { type: "number" },
                    totalSize: { type: "number" },
                    usedPercent: { type: "number" },
                    packCount: { type: "number" },
                    livePackCount: { type: "number" },
                    expiresAt: { type: ["string", "null"] },
                    error: { type: "string" },
                },
                required: [
                    "ok",
                    "totalRemain",
                    "totalUsed",
                    "totalSize",
                    "usedPercent",
                    "packCount",
                    "livePackCount",
                    "expiresAt",
                ],
                additionalProperties: false,
            },
        },
    },
    events: {},
};
