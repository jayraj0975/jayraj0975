/**
 * A small list of heavily used package names per ecosystem, used only to flag
 * one-character near misses (a typosquatting signal). Being on or off this list
 * says nothing about a package's quality.
 */
export const POPULAR: Record<string, Set<string>> = {
  npm: new Set([
    'react', 'react-dom', 'lodash', 'express', 'axios', 'chalk', 'commander', 'debug', 'moment', 'dayjs', 'uuid', 'dotenv', 'typescript',
    'webpack', 'babel-core', 'eslint', 'prettier', 'jest', 'mocha', 'vitest', 'next', 'vue', 'svelte', 'angular', 'rxjs', 'tslib',
    'classnames', 'prop-types', 'redux', 'react-redux', 'react-router', 'react-router-dom', 'styled-components', 'tailwindcss', 'postcss',
    'autoprefixer', 'sass', 'body-parser', 'cors', 'helmet', 'morgan', 'jsonwebtoken', 'bcrypt', 'bcryptjs', 'mongoose', 'sequelize',
    'prisma', 'knex', 'pg', 'mysql', 'mysql2', 'redis', 'ioredis', 'socket.io', 'ws', 'node-fetch', 'cross-fetch', 'request', 'got',
    'yargs', 'minimist', 'glob', 'rimraf', 'mkdirp', 'fs-extra', 'semver', 'colors', 'inquirer', 'ora', 'zod', 'yup', 'joi', 'ajv',
    'date-fns', 'luxon', 'underscore', 'ramda', 'immer', 'zustand', 'mobx', 'graphql', 'apollo-server', 'nodemon', 'concurrently',
    'cross-env', 'husky', 'lint-staged', 'esbuild', 'vite', 'rollup', 'parcel', 'openai', 'stripe', 'twilio', 'aws-sdk', 'firebase',
    'electron', 'puppeteer', 'playwright', 'cheerio', 'jquery', 'bootstrap', 'three', 'd3', 'chart.js', 'marked', 'highlight.js',
    'nodemailer', 'multer', 'passport', 'cookie-parser', 'express-session', 'winston', 'pino', 'bluebird', 'async', 'q', 'shelljs',
    'execa', 'cheerio', 'xml2js', 'js-yaml', 'yaml', 'ini', 'qs', 'querystring', 'form-data', 'mime', 'mime-types', 'path-to-regexp',
    'crypto-js', 'nanoid', 'validator', 'sharp', 'jimp', 'canvas', 'handlebars', 'ejs', 'pug', 'mustache', 'lru-cache', 'eventemitter3',
  ]),
  PyPI: new Set([
    'requests', 'numpy', 'pandas', 'scipy', 'matplotlib', 'seaborn', 'scikit-learn', 'tensorflow', 'torch', 'keras', 'flask', 'django',
    'fastapi', 'uvicorn', 'gunicorn', 'pydantic', 'sqlalchemy', 'alembic', 'psycopg2', 'psycopg2-binary', 'pymongo', 'redis', 'celery',
    'boto3', 'botocore', 'urllib3', 'certifi', 'idna', 'charset-normalizer', 'six', 'setuptools', 'wheel', 'pip', 'pytest', 'black',
    'flake8', 'mypy', 'pylint', 'isort', 'click', 'jinja2', 'markupsafe', 'werkzeug', 'itsdangerous', 'pyyaml', 'python-dateutil',
    'pytz', 'attrs', 'packaging', 'cryptography', 'pyjwt', 'bcrypt', 'paramiko', 'beautifulsoup4', 'lxml', 'pillow', 'opencv-python',
    'transformers', 'openai', 'anthropic', 'langchain', 'httpx', 'aiohttp', 'tqdm', 'rich', 'typer', 'python-dotenv', 'jsonschema',
    'protobuf', 'grpcio', 'selenium', 'scrapy', 'nltk', 'spacy', 'xgboost', 'lightgbm', 'statsmodels', 'sympy', 'networkx', 'plotly',
    'dash', 'streamlit', 'gradio', 'huggingface-hub', 'tokenizers', 'datasets', 'colorama', 'tabulate', 'toml', 'docutils', 'sphinx',
  ]),
};

/** Damerau-Levenshtein (optimal string alignment) distance, capped for speed. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => {
    const row = new Array<number>(b.length + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}
