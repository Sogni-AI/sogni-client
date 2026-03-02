#!/usr/bin/env node
/**
 * Text Chat with Tool Calling (Function Calling) Workflow
 *
 * Demonstrates LLM tool calling via the Sogni Supernet. The LLM decides
 * when to call tools you define, you execute them locally, then feed results
 * back for a natural language answer.
 *
 * Built-in tools:
 *   - get_weather      Live weather for any city worldwide (via wttr.in)
 *   - get_time         Current time in any city / timezone
 *   - convert_units    Unit conversion (temperature, distance, weight, speed)
 *   - calculate        Math expression evaluator
 *
 * Prerequisites:
 * - Set SOGNI_API_KEY or SOGNI_USERNAME/SOGNI_PASSWORD in .env file
 * - LLM workers must be online on the Sogni network
 *
 * Usage:
 *   node workflow_text_chat_tool_calling.mjs
 *   node workflow_text_chat_tool_calling.mjs "What's the weather in Austin, TX?"
 *   node workflow_text_chat_tool_calling.mjs "What time is it in Tokyo and London?"
 *   node workflow_text_chat_tool_calling.mjs "Convert 72°F to celsius"
 *   node workflow_text_chat_tool_calling.mjs "What's 15% of 249.99?"
 *
 * Options:
 *   --model         LLM model ID (default: qwen3-30b-a3b-gptq-int4)
 *   --max-tokens    Maximum tokens to generate (default: 4096)
 *   --temperature   Sampling temperature 0-2 (default: 0.7)
 *   --top-p         Top-p sampling 0-1 (default: 0.9)
 *   --system        System prompt override
 *   --think         Enable model thinking/reasoning (shows <think> blocks)
 *   --no-think      Disable model thinking (default)
 *   --show-thinking  Show <think> blocks in output (hidden by default even when thinking is enabled)
 *   --help          Show this help message
 */

import { SogniClient } from '../dist/index.js';
import { loadCredentials, loadTokenTypePreference } from './credentials.mjs';

const DEFAULT_MODEL = 'qwen3-30b-a3b-gptq-int4';
const DEFAULT_SYSTEM = `You are a helpful assistant with access to tools. Use tools when they would help answer the user's question accurately. You can check weather, get the current time, convert units, and do math. Always respond naturally after receiving tool results.`;

// ============================================================
// CLI Argument Parsing
// ============================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    prompt: null,
    model: DEFAULT_MODEL,
    maxTokens: 4096,
    temperature: 0.7,
    topP: 0.9,
    system: DEFAULT_SYSTEM,
    think: false,
    thinkExplicit: false,
    showThinking: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--model' && args[i + 1]) {
      options.model = args[++i];
    } else if (arg === '--max-tokens' && args[i + 1]) {
      options.maxTokens = parseInt(args[++i], 10);
    } else if (arg === '--temperature' && args[i + 1]) {
      options.temperature = parseFloat(args[++i]);
    } else if (arg === '--top-p' && args[i + 1]) {
      options.topP = parseFloat(args[++i]);
    } else if (arg === '--system' && args[i + 1]) {
      options.system = args[++i];
    } else if (arg === '--think') {
      options.think = true;
      options.thinkExplicit = true;
    } else if (arg === '--no-think') {
      options.think = false;
      options.thinkExplicit = true;
    } else if (arg === '--show-thinking') {
      options.showThinking = true;
    } else if (!arg.startsWith('--') && !options.prompt) {
      options.prompt = arg;
    } else if (!arg.startsWith('--')) {
      options.prompt = options.prompt ? `${options.prompt} ${arg}` : arg;
    } else {
      console.error(`Unknown option: ${arg}`);
      showHelp();
      process.exit(1);
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Text Chat with Tool Calling (Function Calling)

Usage:
  node workflow_text_chat_tool_calling.mjs                                    # Interactive
  node workflow_text_chat_tool_calling.mjs "What's the weather in Austin?"    # Weather
  node workflow_text_chat_tool_calling.mjs "What time is it in London?"       # Time
  node workflow_text_chat_tool_calling.mjs "Convert 100kg to pounds"          # Conversion
  node workflow_text_chat_tool_calling.mjs "What's sqrt(144) * 3?"            # Calculator

Tools:
  get_weather      Live weather for any city (via wttr.in, no API key needed)
  get_time         Current time in any city or IANA timezone
  convert_units    Temperature, distance, weight, speed conversions
  calculate        Math expression evaluator

Options:
  --model         LLM model ID (default: ${DEFAULT_MODEL})
  --max-tokens    Maximum tokens to generate (default: 4096)
  --temperature   Sampling temperature 0-2 (default: 0.7)
  --top-p         Top-p sampling 0-1 (default: 0.9)
  --system        System prompt override
  --think         Enable model thinking/reasoning (shows <think> blocks)
  --no-think      Disable model thinking (default)
  --show-thinking  Show <think> blocks in output (hidden by default)
  --help          Show this help message
`);
}

async function askQuestion(question) {
  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Create a streaming writer that filters <think>...</think> blocks from display.
 * Returns { write(text), flush() } — call write() for each chunk, flush() when done.
 */
function createThinkingFilter(showThinking) {
  let insideThink = false;
  let buffer = '';

  return {
    write(text) {
      if (showThinking) {
        process.stdout.write(text);
        return;
      }

      buffer += text;

      while (buffer.length > 0) {
        if (insideThink) {
          const endIdx = buffer.indexOf('</think>');
          if (endIdx === -1) {
            buffer = '';
            break;
          }
          buffer = buffer.slice(endIdx + 8);
          insideThink = false;
        } else {
          const startIdx = buffer.indexOf('<think>');
          if (startIdx === -1) {
            const safeLen = Math.max(0, buffer.length - 6);
            if (safeLen > 0) {
              process.stdout.write(buffer.slice(0, safeLen));
              buffer = buffer.slice(safeLen);
            }
            break;
          }
          if (startIdx > 0) {
            process.stdout.write(buffer.slice(0, startIdx));
          }
          buffer = buffer.slice(startIdx + 7);
          insideThink = true;
        }
      }
    },

    flush() {
      if (!showThinking && buffer.length > 0) {
        process.stdout.write(buffer);
        buffer = '';
      }
    },
  };
}

// ============================================================
// Tool Definitions (OpenAI-compatible format)
// ============================================================

const tools = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description:
        'Get current weather conditions for any city worldwide. Returns temperature, conditions, humidity, wind, and more. Uses live data from wttr.in.',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description:
              'City name, optionally with state/country (e.g. "Austin, TX", "Tokyo", "London, UK", "São Paulo, Brazil")',
          },
          unit: {
            type: 'string',
            enum: ['celsius', 'fahrenheit'],
            description: 'Temperature unit. Defaults to fahrenheit for US cities, celsius otherwise.',
          },
        },
        required: ['location'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_time',
      description:
        'Get the current date and time in a given city or IANA timezone. Useful for "what time is it in..." questions.',
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description:
              'IANA timezone name (e.g. "America/New_York", "Europe/London", "Asia/Tokyo") or a major city name.',
          },
        },
        required: ['timezone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'convert_units',
      description:
        'Convert a value between units. Supports temperature (C/F/K), distance (km/mi/m/ft/in/yd/cm/mm), weight (kg/lb/oz/g/mg/stone/ton/tonne), and speed (mph/kph/m_s/knots).',
      parameters: {
        type: 'object',
        properties: {
          value: {
            type: 'number',
            description: 'The numeric value to convert.',
          },
          from_unit: {
            type: 'string',
            description:
              'Source unit (e.g. "celsius", "fahrenheit", "kelvin", "km", "miles", "kg", "lb", "mph", "kph").',
          },
          to_unit: {
            type: 'string',
            description:
              'Target unit (e.g. "celsius", "fahrenheit", "kelvin", "km", "miles", "kg", "lb", "mph", "kph").',
          },
        },
        required: ['value', 'from_unit', 'to_unit'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description:
        'Evaluate a mathematical expression. Supports +, -, *, /, ** (exponent), % (modulo), parentheses, and functions: sqrt, abs, round, floor, ceil, sin, cos, tan, log, log2, log10, exp, pow, min, max, PI, E.',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description:
              'The math expression to evaluate (e.g. "2 + 2", "sqrt(144)", "3.14 * 10**2", "(5 + 3) * 12").',
          },
        },
        required: ['expression'],
      },
    },
  },
];

// ============================================================
// Tool Implementations
// ============================================================

/**
 * Fetch live weather data from wttr.in (free, no API key required).
 */
async function getWeather(location, unit) {
  try {
    const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'sogni-tool-calling-demo' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return JSON.stringify({ error: `Weather service returned ${response.status} for "${location}"` });
    }

    const data = await response.json();
    const current = data.current_condition?.[0];
    const area = data.nearest_area?.[0];

    if (!current) {
      return JSON.stringify({ error: `No weather data found for "${location}"` });
    }

    const areaName = area?.areaName?.[0]?.value || location;
    const country = area?.country?.[0]?.value || '';
    const region = area?.region?.[0]?.value || '';

    // Default to fahrenheit for US locations
    const useFahrenheit =
      unit === 'fahrenheit' ||
      (!unit &&
        (country === 'United States of America' ||
          /,\s*(US|USA|TX|CA|NY|FL|IL|PA|OH|GA|NC|MI|NJ|VA|WA|AZ|MA|TN|IN|MO|MD|WI|CO|MN|SC|AL|LA|KY|OR|OK|CT|UT|IA|NV|AR|MS|KS|NM|NE|ID|WV|HI|NH|ME|MT|RI|DE|SD|ND|AK|VT|WY|DC)$/i.test(
            location,
          )));

    const temp = useFahrenheit ? `${current.temp_F}°F` : `${current.temp_C}°C`;
    const feelsLike = useFahrenheit ? `${current.FeelsLikeF}°F` : `${current.FeelsLikeC}°C`;

    return JSON.stringify({
      location: `${areaName}${region ? ', ' + region : ''}${country ? ', ' + country : ''}`,
      temperature: temp,
      feels_like: feelsLike,
      conditions: current.weatherDesc?.[0]?.value || 'Unknown',
      humidity: `${current.humidity}%`,
      wind: `${useFahrenheit ? current.windspeedMiles + ' mph' : current.windspeedKmph + ' km/h'} ${current.winddir16Point}`,
      visibility: useFahrenheit ? `${current.visibilityMiles} miles` : `${current.visibility} km`,
      uv_index: current.uvIndex,
      unit: useFahrenheit ? 'fahrenheit' : 'celsius',
    });
  } catch (err) {
    return JSON.stringify({ error: `Failed to fetch weather: ${err.message}` });
  }
}

// City-to-timezone mapping for common cities
const CITY_TIMEZONES = {
  'new york': 'America/New_York',
  nyc: 'America/New_York',
  manhattan: 'America/New_York',
  'los angeles': 'America/Los_Angeles',
  la: 'America/Los_Angeles',
  chicago: 'America/Chicago',
  houston: 'America/Chicago',
  dallas: 'America/Chicago',
  austin: 'America/Chicago',
  'san antonio': 'America/Chicago',
  phoenix: 'America/Phoenix',
  denver: 'America/Denver',
  seattle: 'America/Los_Angeles',
  portland: 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles',
  'las vegas': 'America/Los_Angeles',
  miami: 'America/New_York',
  atlanta: 'America/New_York',
  boston: 'America/New_York',
  washington: 'America/New_York',
  dc: 'America/New_York',
  philadelphia: 'America/New_York',
  detroit: 'America/Detroit',
  minneapolis: 'America/Chicago',
  honolulu: 'Pacific/Honolulu',
  hawaii: 'Pacific/Honolulu',
  anchorage: 'America/Anchorage',
  alaska: 'America/Anchorage',
  london: 'Europe/London',
  paris: 'Europe/Paris',
  berlin: 'Europe/Berlin',
  madrid: 'Europe/Madrid',
  rome: 'Europe/Rome',
  amsterdam: 'Europe/Amsterdam',
  moscow: 'Europe/Moscow',
  istanbul: 'Europe/Istanbul',
  athens: 'Europe/Athens',
  dublin: 'Europe/Dublin',
  lisbon: 'Europe/Lisbon',
  zurich: 'Europe/Zurich',
  vienna: 'Europe/Vienna',
  stockholm: 'Europe/Stockholm',
  oslo: 'Europe/Oslo',
  copenhagen: 'Europe/Copenhagen',
  helsinki: 'Europe/Helsinki',
  warsaw: 'Europe/Warsaw',
  prague: 'Europe/Prague',
  budapest: 'Europe/Budapest',
  dubai: 'Asia/Dubai',
  'abu dhabi': 'Asia/Dubai',
  riyadh: 'Asia/Riyadh',
  mumbai: 'Asia/Kolkata',
  delhi: 'Asia/Kolkata',
  bangalore: 'Asia/Kolkata',
  kolkata: 'Asia/Kolkata',
  chennai: 'Asia/Kolkata',
  singapore: 'Asia/Singapore',
  'hong kong': 'Asia/Hong_Kong',
  shanghai: 'Asia/Shanghai',
  beijing: 'Asia/Shanghai',
  shenzhen: 'Asia/Shanghai',
  tokyo: 'Asia/Tokyo',
  osaka: 'Asia/Tokyo',
  seoul: 'Asia/Seoul',
  taipei: 'Asia/Taipei',
  bangkok: 'Asia/Bangkok',
  jakarta: 'Asia/Jakarta',
  'kuala lumpur': 'Asia/Kuala_Lumpur',
  manila: 'Asia/Manila',
  hanoi: 'Asia/Ho_Chi_Minh',
  'ho chi minh': 'Asia/Ho_Chi_Minh',
  sydney: 'Australia/Sydney',
  melbourne: 'Australia/Melbourne',
  brisbane: 'Australia/Brisbane',
  perth: 'Australia/Perth',
  auckland: 'Pacific/Auckland',
  toronto: 'America/Toronto',
  vancouver: 'America/Vancouver',
  montreal: 'America/Toronto',
  'mexico city': 'America/Mexico_City',
  'são paulo': 'America/Sao_Paulo',
  'sao paulo': 'America/Sao_Paulo',
  'rio de janeiro': 'America/Sao_Paulo',
  'buenos aires': 'America/Argentina/Buenos_Aires',
  santiago: 'America/Santiago',
  lima: 'America/Lima',
  bogota: 'America/Bogota',
  cairo: 'Africa/Cairo',
  johannesburg: 'Africa/Johannesburg',
  lagos: 'Africa/Lagos',
  nairobi: 'Africa/Nairobi',
  casablanca: 'Africa/Casablanca',
};

function getTime(timezone) {
  try {
    let tz = timezone;

    // If it looks like a city name (no slash), try our mapping
    if (!timezone.includes('/')) {
      const key = timezone.toLowerCase().replace(/[,.].*$/, '').trim();
      tz = CITY_TIMEZONES[key] || timezone;
    }

    const now = new Date();
    const formatted = now.toLocaleString('en-US', {
      timeZone: tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    });

    // Get UTC offset
    let utcOffset = '';
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        timeZoneName: 'longOffset',
      }).formatToParts(now);
      const tzPart = parts.find((p) => p.type === 'timeZoneName');
      utcOffset = tzPart?.value || '';
    } catch {
      /* offset not available */
    }

    return JSON.stringify({
      timezone: tz,
      datetime: formatted,
      iso: now.toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T'),
      utc_offset: utcOffset,
    });
  } catch {
    return JSON.stringify({
      error: `Unknown timezone "${timezone}". Use IANA format like "America/New_York" or a major city name.`,
    });
  }
}

function convertUnits(value, fromUnit, toUnit) {
  const from = fromUnit.toLowerCase().replace(/[°\s]/g, '');
  const to = toUnit.toLowerCase().replace(/[°\s]/g, '');

  // Temperature
  const tempUnits = {
    c: 'celsius',
    celsius: 'celsius',
    f: 'fahrenheit',
    fahrenheit: 'fahrenheit',
    k: 'kelvin',
    kelvin: 'kelvin',
  };

  if (tempUnits[from] && tempUnits[to]) {
    const fromT = tempUnits[from];
    const toT = tempUnits[to];

    // Convert to Celsius first
    let celsius;
    if (fromT === 'celsius') celsius = value;
    else if (fromT === 'fahrenheit') celsius = ((value - 32) * 5) / 9;
    else celsius = value - 273.15; // kelvin

    // Convert from Celsius to target
    let result;
    if (toT === 'celsius') result = celsius;
    else if (toT === 'fahrenheit') result = (celsius * 9) / 5 + 32;
    else result = celsius + 273.15; // kelvin

    return JSON.stringify({
      input: `${value} ${fromUnit}`,
      result: `${parseFloat(result.toFixed(4))} ${toUnit}`,
      value: parseFloat(result.toFixed(4)),
    });
  }

  // Distance (base: meters)
  const distToMeters = {
    m: 1,
    meters: 1,
    meter: 1,
    km: 1000,
    kilometers: 1000,
    kilometer: 1000,
    mi: 1609.344,
    miles: 1609.344,
    mile: 1609.344,
    ft: 0.3048,
    feet: 0.3048,
    foot: 0.3048,
    in: 0.0254,
    inches: 0.0254,
    inch: 0.0254,
    yd: 0.9144,
    yards: 0.9144,
    yard: 0.9144,
    cm: 0.01,
    centimeters: 0.01,
    centimeter: 0.01,
    mm: 0.001,
    millimeters: 0.001,
    millimeter: 0.001,
    nm: 1852,
    'nautical miles': 1852,
    'nautical mile': 1852,
  };

  if (distToMeters[from] && distToMeters[to]) {
    const meters = value * distToMeters[from];
    const result = meters / distToMeters[to];
    return JSON.stringify({
      input: `${value} ${fromUnit}`,
      result: `${parseFloat(result.toFixed(6))} ${toUnit}`,
      value: parseFloat(result.toFixed(6)),
    });
  }

  // Weight (base: grams)
  const weightToGrams = {
    g: 1,
    grams: 1,
    gram: 1,
    kg: 1000,
    kilograms: 1000,
    kilogram: 1000,
    lb: 453.592,
    lbs: 453.592,
    pounds: 453.592,
    pound: 453.592,
    oz: 28.3495,
    ounces: 28.3495,
    ounce: 28.3495,
    mg: 0.001,
    milligrams: 0.001,
    milligram: 0.001,
    st: 6350.29,
    stones: 6350.29,
    stone: 6350.29,
    ton: 907185,
    tons: 907185,
    tonne: 1000000,
    tonnes: 1000000,
  };

  if (weightToGrams[from] && weightToGrams[to]) {
    const grams = value * weightToGrams[from];
    const result = grams / weightToGrams[to];
    return JSON.stringify({
      input: `${value} ${fromUnit}`,
      result: `${parseFloat(result.toFixed(6))} ${toUnit}`,
      value: parseFloat(result.toFixed(6)),
    });
  }

  // Speed (base: m/s)
  const speedToMs = {
    mph: 0.44704,
    'mi/h': 0.44704,
    kph: 0.277778,
    'km/h': 0.277778,
    kmh: 0.277778,
    'm/s': 1,
    ms: 1,
    m_s: 1,
    knots: 0.514444,
    knot: 0.514444,
    kn: 0.514444,
    'ft/s': 0.3048,
  };

  if (speedToMs[from] && speedToMs[to]) {
    const ms = value * speedToMs[from];
    const result = ms / speedToMs[to];
    return JSON.stringify({
      input: `${value} ${fromUnit}`,
      result: `${parseFloat(result.toFixed(4))} ${toUnit}`,
      value: parseFloat(result.toFixed(4)),
    });
  }

  return JSON.stringify({
    error: `Cannot convert from "${fromUnit}" to "${toUnit}". Supported: temperature (C/F/K), distance (km/mi/m/ft/in/yd/cm/mm), weight (kg/lb/oz/g/mg/stone/ton/tonne), speed (mph/kph/m_s/knots).`,
  });
}

function calculate(expression) {
  try {
    const mathContext = {
      sqrt: Math.sqrt,
      abs: Math.abs,
      round: Math.round,
      floor: Math.floor,
      ceil: Math.ceil,
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      asin: Math.asin,
      acos: Math.acos,
      atan: Math.atan,
      log: Math.log,
      log2: Math.log2,
      log10: Math.log10,
      exp: Math.exp,
      pow: Math.pow,
      min: Math.min,
      max: Math.max,
      PI: Math.PI,
      E: Math.E,
      pi: Math.PI,
      e: Math.E,
    };

    // Block anything that looks like code injection
    const sanitized = expression.replace(/\s+/g, ' ').trim();
    if (/[;{}[\]`\\'"$]|function|return|var|let|const|import|require|eval|this|process|global/.test(sanitized)) {
      return JSON.stringify({
        error: 'Invalid expression. Use numbers, operators (+, -, *, /, **, %), parentheses, and math functions.',
      });
    }

    // Replace ^ with ** for exponentiation
    const prepared = sanitized.replace(/\^/g, '**');

    const fn = new Function(...Object.keys(mathContext), `return (${prepared})`);
    const result = fn(...Object.values(mathContext));

    if (typeof result !== 'number' || !isFinite(result)) {
      return JSON.stringify({ error: `Expression "${expression}" resulted in ${result}` });
    }

    return JSON.stringify({
      expression,
      result: Number.isInteger(result) ? result : parseFloat(result.toPrecision(15)),
    });
  } catch (err) {
    return JSON.stringify({ error: `Failed to evaluate "${expression}": ${err.message}` });
  }
}

async function executeToolCall(toolCall) {
  const args = JSON.parse(toolCall.function.arguments);
  console.log(`  Executing: ${toolCall.function.name}(${JSON.stringify(args)})`);

  switch (toolCall.function.name) {
    case 'get_weather':
      return await getWeather(args.location, args.unit);
    case 'get_time':
      return getTime(args.timezone);
    case 'convert_units':
      return convertUnits(args.value, args.from_unit, args.to_unit);
    case 'calculate':
      return calculate(args.expression);
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolCall.function.name}` });
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  const options = parseArgs();

  console.log('='.repeat(60));
  console.log('  Sogni Chat — Tool Calling Demo');
  console.log('  (Weather, Time, Unit Conversion, Calculator)');
  console.log('='.repeat(60));
  showHelp();

  // Load credentials
  const credentials = await loadCredentials();

  // Prompt for message if not given
  if (!options.prompt) {
    console.log('Example queries:');
    console.log('  "What\'s the weather in Austin, TX?"');
    console.log('  "What time is it in Tokyo and London?"');
    console.log('  "Convert 72°F to celsius"');
    console.log('  "What\'s 15% of 249.99?"');
    console.log();
    options.prompt = await askQuestion('You: ');
    if (!options.prompt) {
      console.error('No prompt provided.');
      process.exit(1);
    }

    // Ask about thinking mode if not specified via CLI
    if (!options.thinkExplicit) {
      console.log();
      console.log('Thinking mode lets the model reason step-by-step before answering.');
      console.log('Best for: complex reasoning, math, logic puzzles, code debugging, analysis.');
      const thinkAnswer = await askQuestion('Enable thinking mode? (y/N): ');
      options.think = thinkAnswer.toLowerCase() === 'y' || thinkAnswer.toLowerCase() === 'yes';
    }
  }

  // Connect to Sogni
  console.log();
  console.log('Connecting to Sogni...');
  const testnet = process.env.SOGNI_TESTNET === 'true';
  const socketEndpoint = process.env.SOGNI_SOCKET_ENDPOINT;
  const restEndpoint = process.env.SOGNI_REST_ENDPOINT;

  if (testnet) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  const sogni = await SogniClient.createInstance({
    appId: `sogni-tool-calling-${Date.now()}`,
    network: 'fast',
    ...(credentials.apiKey && { apiKey: credentials.apiKey }),
    ...(testnet && { testnet }),
    ...(socketEndpoint && { socketEndpoint }),
    ...(restEndpoint && { restEndpoint }),
  });

  if (!credentials.apiKey) {
    await sogni.account.login(credentials.username, credentials.password);
    console.log(`Logged in as: ${credentials.username}`);
  } else {
    console.log('Authenticated with API key');
  }
  console.log();

  // Wait for LLM models to be received from the network
  let availableModels = {};
  try {
    availableModels = await sogni.chat.waitForModels();
    console.log('Available LLM models:');
    const modelIds = Object.keys(availableModels);
    for (let i = 0; i < modelIds.length; i++) {
      const id = modelIds[i];
      const workers = availableModels[id].workers;
      console.log(`  [${i + 1}] ${id} (${workers} worker${workers !== 1 ? 's' : ''})`);
    }
    console.log();

    // If user didn't specify --model and there are multiple models, let them choose
    if (options.model === DEFAULT_MODEL && modelIds.length > 1) {
      const choice = await askQuestion(`Select model [1-${modelIds.length}] (default: 1): `);
      const idx = parseInt(choice, 10);
      if (idx >= 1 && idx <= modelIds.length) {
        options.model = modelIds[idx - 1];
      } else if (!choice) {
        options.model = modelIds[0];
      }
    } else if (options.model === DEFAULT_MODEL && modelIds.length === 1) {
      options.model = modelIds[0];
    }
  } catch {
    console.log('Warning: No LLM models currently available on the network');
    console.log();
  }

  // Load token type preference
  const tokenType = loadTokenTypePreference() || 'sogni';
  const tokenLabel = tokenType === 'spark' ? 'SPARK' : 'SOGNI';

  // Build messages
  const systemContent = options.think ? options.system : `${options.system} /no_think`;
  const messages = [
    { role: 'system', content: systemContent },
    { role: 'user', content: options.prompt },
  ];

  // Display request info
  console.log(`Model:       ${options.model}`);
  console.log(`Max Tokens:  ${options.maxTokens}`);
  console.log(`Temperature: ${options.temperature}`);
  console.log(`Thinking:    ${options.think ? 'enabled' : 'disabled'}`);
  console.log(`Payment:     ${tokenLabel}`);
  console.log(`Prompt:      ${options.prompt.length > 80 ? options.prompt.slice(0, 80) + '...' : options.prompt}`);
  console.log(`Tools:       ${tools.map((t) => t.function.name).join(', ')}`);
  console.log();

  // Estimate cost and check balance before submitting
  try {
    const estimate = await sogni.chat.estimateCost({
      model: options.model,
      messages,
      max_tokens: options.maxTokens,
      tokenType,
    });
    await sogni.account.refreshBalance();
    const balance = sogni.account.currentAccount.balance;
    const available = parseFloat(tokenType === 'spark' ? balance.spark.net : balance.sogni.net);
    console.log(`Est. Cost:   ${estimate.costInToken.toFixed(6)} ${tokenLabel} (~$${estimate.costInUSD.toFixed(6)})`);
    console.log(`Balance:     ${available.toFixed(4)} ${tokenLabel}`);
    console.log();

    if (available < estimate.costInToken) {
      console.error(
        `Insufficient balance. You need at least ${estimate.costInToken.toFixed(6)} ${tokenLabel} but have ${available.toFixed(4)} ${tokenLabel}.`,
      );
      console.error(`Tip: Reduce --max-tokens to lower the estimated cost, or add funds at https://app.sogni.ai`);
      process.exit(1);
    }
  } catch {
    console.log('(Could not estimate cost, proceeding with request)');
    console.log();
  }

  // Listen for job state events (worker assignment)
  sogni.chat.on('jobState', (event) => {
    if (event.type === 'pending') {
      console.log(`Status:      pending authorization`);
    } else if (event.type === 'queued') {
      console.log(`Status:      queued`);
    } else if (event.type === 'assigned' && event.workerName) {
      console.log(`Worker:      ${event.workerName} (assigned)`);
    } else if (event.type === 'initiatingModel' && event.workerName) {
      console.log(`Worker:      ${event.workerName} (initiating)`);
    } else if (event.type === 'jobStarted' && event.workerName) {
      console.log(`Worker:      ${event.workerName} (started)`);
    }
  });

  // Tool calling loop — may require multiple rounds if the model calls tools repeatedly
  const MAX_ROUNDS = 5;
  const startTime = Date.now();
  let lastResult = null;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      console.log('-'.repeat(60));
      console.log(`[Round ${round + 1}] Sending to LLM...`);

      const stream = await sogni.chat.completions.create({
        model: options.model,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        top_p: options.topP,
        stream: true,
        tokenType,
      });

      // Stream the response
      process.stdout.write('\nAssistant: ');
      const filter = createThinkingFilter(options.showThinking);
      for await (const chunk of stream) {
        if (chunk.content) {
          filter.write(chunk.content);
        }
      }
      filter.flush();
      console.log();

      const result = stream.finalResult;
      lastResult = result;
      if (!result) break;

      // If the model called tools, execute them and loop back
      if (result.finishReason === 'tool_calls' && result.tool_calls && result.tool_calls.length > 0) {
        console.log(`\n  Model requested ${result.tool_calls.length} tool call(s):`);

        // Add the assistant's response (with tool_calls) to messages
        messages.push({
          role: 'assistant',
          content: result.content || null,
          tool_calls: result.tool_calls,
        });

        // Execute each tool call and collect results
        for (const toolCall of result.tool_calls) {
          let toolResult;
          try {
            toolResult = await executeToolCall(toolCall);
          } catch (e) {
            toolResult = JSON.stringify({ error: e.message });
          }
          console.log(`  Result: ${toolResult.slice(0, 120)}${toolResult.length > 120 ? '...' : ''}`);

          // Add tool result to messages
          messages.push({
            role: 'tool',
            content: toolResult,
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
          });
        }

        // Continue loop to get LLM's response to tool results
        continue;
      }

      // Model responded with text — we're done
      break;
    }
  } catch (err) {
    if (err.message.includes('insufficient_balance')) {
      const balance = sogni.account.currentAccount.balance;
      const available = parseFloat(tokenType === 'spark' ? balance.spark.net : balance.sogni.net);
      console.error(`\nInsufficient balance. You have ${available.toFixed(4)} ${tokenLabel}.`);
      console.error(`Tip: Reduce --max-tokens to lower the estimated cost, or add funds at https://app.sogni.ai`);
    } else {
      console.error('\nChat completion failed:', err.message);
    }
    process.exit(1);
  }

  // Print final stats
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log();
  console.log('-'.repeat(60));
  if (lastResult?.workerName) {
    console.log(`Worker:      ${lastResult.workerName}`);
  }
  console.log(`Time:        ${elapsed}s${lastResult ? ` (server: ${lastResult.timeTaken.toFixed(2)}s)` : ''}`);
  console.log(`Finish:      ${lastResult?.finishReason || 'unknown'}`);
  if (lastResult?.usage) {
    const tps = lastResult.usage.completion_tokens / lastResult.timeTaken;
    console.log(
      `Tokens:      ${lastResult.usage.prompt_tokens} prompt + ${lastResult.usage.completion_tokens} completion = ${lastResult.usage.total_tokens} total`,
    );
    console.log(`Speed:       ${tps.toFixed(1)} tokens/sec`);
  }
  console.log();

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
