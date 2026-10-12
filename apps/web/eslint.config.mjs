import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

const config = [...nextVitals, ...nextTs, prettier, { ignores: ['.next/**', 'next-env.d.ts'] }];

export default config;
