declare module "express" {
    import type { IncomingMessage, ServerResponse } from "node:http";

    export interface Request extends IncomingMessage {}

    export interface Response extends ServerResponse {
        sendFile(filePath: string, options: { root: string }): void;
    }

    export interface Application {
        (request: IncomingMessage, response: ServerResponse): void;
        disable(setting: string): void;
        use(handler: unknown): void;
        get(
            route: string,
            handler: (request: Request, response: Response) => void,
        ): void;
    }

    type ExpressFactory = {
        (): Application;
        static(root: string, options?: { redirect?: boolean }): unknown;
    };

    const express: ExpressFactory;
    export default express;
}
