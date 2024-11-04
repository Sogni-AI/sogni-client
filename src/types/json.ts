export type JSONValue = undefined | null | string | number | boolean | JSONObject | JSONArray;

export type JSONObject = { [x: string]: JSONValue };

export type JSONArray = Array<JSONValue>;
