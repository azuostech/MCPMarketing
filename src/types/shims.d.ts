declare module 'http' {
  const http: any;
  export default http;
}

declare module 'url' {
  const URL: any;
  export { URL };
}

declare const process: {
  env: Record<string, string | undefined>;
  exit: (code?: number) => never;
};

declare const fetch: (input: any, init?: any) => Promise<any>;
