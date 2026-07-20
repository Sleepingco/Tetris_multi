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
