// 프로젝트가 사용하는 최소 Express 표면만 보완하는 컴파일용 선언이다.
// 런타임 요청 검증이나 보안 경계를 대신하지 않는다.
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
