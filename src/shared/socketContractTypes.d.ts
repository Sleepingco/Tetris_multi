// socketContracts.mjs의 런타임 schema에서 wire 입력과 검증 후 출력 타입을 함께 유도한다.
// 이 파일은 컴파일용이며, 실제 외부 입력 검증은 반드시 Zod schema가 담당한다.
import type * as z from "zod";
import {
    clientToServerSchemas,
    serverToClientSchemas,
} from "./socketContracts.mjs";

type SchemaMap = Record<string, z.ZodType>;
type WirePayload<T extends SchemaMap, K extends keyof T> = z.input<T[K]>;
type ParsedPayload<T extends SchemaMap, K extends keyof T> = z.output<T[K]>;

export type ClientToServerEventName = keyof typeof clientToServerSchemas;
export type ServerToClientEventName = keyof typeof serverToClientSchemas;

export type ClientToServerWirePayload<K extends ClientToServerEventName> = WirePayload<
    typeof clientToServerSchemas,
    K
>;
export type ClientToServerParsedPayload<K extends ClientToServerEventName> = ParsedPayload<
    typeof clientToServerSchemas,
    K
>;
export type ServerToClientWirePayload<K extends ServerToClientEventName> = WirePayload<
    typeof serverToClientSchemas,
    K
>;
export type ServerToClientParsedPayload<K extends ServerToClientEventName> = ParsedPayload<
    typeof serverToClientSchemas,
    K
>;

export type ClientToServerEvents = {
    [K in ClientToServerEventName]: (payload: ClientToServerWirePayload<K>) => void;
};
export type ServerToClientEvents = {
    [K in ServerToClientEventName]: (payload: ServerToClientWirePayload<K>) => void;
};
