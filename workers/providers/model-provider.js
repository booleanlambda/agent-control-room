import { AsyncLocalStorage } from 'node:async_hooks';
import {
  nvidiaChatCompletion,
  nvidiaConfigStatus,
  probeNvidia,
} from './nvidia.js';
import {
  moonshotChatCompletion,
  moonshotConfigStatus,
  probeMoonshot,
} from './moonshot.js';

const providerContext = new AsyncLocalStorage();

const adapters = Object.freeze({
  nvidia_direct: Object.freeze({
    chatCompletion: nvidiaChatCompletion,
    configStatus: nvidiaConfigStatus,
    probe: probeNvidia,
  }),
  moonshot_direct: Object.freeze({
    chatCompletion: moonshotChatCompletion,
    configStatus: moonshotConfigStatus,
    probe: probeMoonshot,
  }),
});

function clean(value){
  return String(value||'').trim().toLowerCase();
}

function configuredProvider(){
  const provider=clean(process.env.AAU_MODEL_PROVIDER);
  if(!provider){
    const error=new Error('AAU_MODEL_PROVIDER is not configured');
    error.code='MODEL_PROVIDER_NOT_CONFIGURED';
    throw error;
  }
  return provider;
}

function resolveProvider(explicit=null){
  const provider=clean(explicit)||clean(providerContext.getStore())||configuredProvider();
  const adapter=adapters[provider];
  if(!adapter){
    const error=new Error(`unsupported_model_provider:${provider}`);
    error.code='MODEL_PROVIDER_UNSUPPORTED';
    error.provider=provider;
    throw error;
  }
  return {provider,adapter};
}

export function withModelProviderContext(provider,fn){
  if(typeof fn!=='function')throw new TypeError('withModelProviderContext requires a function');
  const resolved=resolveProvider(provider);
  return providerContext.run(resolved.provider,fn);
}

export function activeModelProvider(){
  return resolveProvider().provider;
}

export async function modelChatCompletion(options={}){
  const requested=options&&typeof options==='object'?options:{};
  const explicit=requested.provider??null;
  const {provider,adapter}=resolveProvider(explicit);
  const {provider:_ignored,...adapterOptions}=requested;
  const result=await adapter.chatCompletion(adapterOptions);
  return {
    ...result,
    provider,
    transport_provider:result?.provider||provider,
  };
}

export function modelProviderConfigStatus(provider=null){
  const resolved=resolveProvider(provider);
  return {
    provider:resolved.provider,
    ...resolved.adapter.configStatus(),
  };
}

export async function probeModelProvider(provider=null){
  const resolved=resolveProvider(provider);
  const result=await resolved.adapter.probe();
  return {
    provider:resolved.provider,
    ...result,
  };
}
