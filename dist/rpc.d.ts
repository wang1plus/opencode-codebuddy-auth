/**
 * Shared RPC contract between the server plugin (which owns the OAuth
 * credential) and the TUI plugin (which only has a client connection).
 */
export declare const creditsRpc: {
    id: string;
    methods: {
        credits: {
            input: {
                type: string;
                properties: {};
                additionalProperties: boolean;
            };
            output: {
                type: string;
                properties: {
                    ok: {
                        type: string;
                    };
                    totalRemain: {
                        type: string;
                    };
                    totalUsed: {
                        type: string;
                    };
                    totalSize: {
                        type: string;
                    };
                    usedPercent: {
                        type: string;
                    };
                    packCount: {
                        type: string;
                    };
                    livePackCount: {
                        type: string;
                    };
                    expiresAt: {
                        type: string[];
                    };
                    error: {
                        type: string;
                    };
                };
                required: string[];
                additionalProperties: boolean;
            };
        };
    };
    events: {};
};
export type CreditsRpc = typeof creditsRpc;
