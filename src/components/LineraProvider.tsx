import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import * as linera from '@linera/client';
import { PrivateKey } from '@linera/signer';
import { Wallet } from 'ethers';

interface LineraContextType {
  client?: linera.Client;
  wallet?: linera.Wallet;
  chainId?: string;
  application?: linera.Application;
  accountOwner?: string;
  ready: boolean;
  error?: Error;
  reinitializeClient?: () => Promise<void>;
}

const LineraContext = createContext<LineraContextType>({ ready: false });

export const useLinera = () => useContext(LineraContext);

export function LineraProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LineraContextType>({ ready: false });
  const initRef = useRef(false);
  const reinitCooldownRef = useRef<number>(0);

  const reinitializeClient = async () => {
    const now = Date.now();
    if (now - reinitCooldownRef.current < 5000) {
      // Throttle re-initialization attempts to every 5s
      return;
    }
    reinitCooldownRef.current = now;

    const doReinit = async (attempt = 0): Promise<void> => {
      try {
        // Re-init WASM module (best-effort)
        try { await linera.default(); } catch { }

        const faucetUrl = (import.meta as any).env.VITE_LINERA_FAUCET_URL;
        const applicationId = (import.meta as any).env.VITE_LINERA_APPLICATION_ID;
        if (!faucetUrl || !applicationId) {
          throw new Error('Missing Linera env configuration');
        }

        const generated = Wallet.createRandom();
        const phrase = generated.mnemonic?.phrase;
        if (!phrase) throw new Error('Failed to generate mnemonic');
        localStorage.setItem('linera_mnemonic', phrase);

        const signer = PrivateKey.fromMnemonic(phrase);
        const faucet = new linera.Faucet(faucetUrl);
        const owner = signer.address();

        const wallet = await faucet.createWallet();
        const chainId = await faucet.claimChain(wallet, owner);

        const clientInstance = await new linera.Client(wallet, signer, false);
        const application = await clientInstance.frontend().application(applicationId);

        setState({
          client: clientInstance,
          wallet,
          chainId,
          application,
          accountOwner: owner,
          ready: true,
          error: undefined,
          reinitializeClient,
        });
      } catch (error) {
        const msg = String((error as any)?.message || error);
        // Retry once on characteristic WASM memory abort signatures
        if (attempt === 0 && (msg.includes('RuntimeError') || msg.includes('unreachable') || msg.includes('malloc'))) {
          await new Promise(r => setTimeout(r, 300));
          return doReinit(1);
        }
        setState(prev => ({ ...prev, ready: false, error: error as Error }));
      }
    };

    return doReinit(0);
  };

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    (async () => {
      try {
        await linera.default();

        const faucetUrl = (import.meta as any).env.VITE_LINERA_FAUCET_URL;
        const applicationId = (import.meta as any).env.VITE_LINERA_APPLICATION_ID;
        if (!faucetUrl || !applicationId) {
          throw new Error('Missing Linera env configuration');
        }

        let mnemonic = localStorage.getItem('linera_mnemonic');
        if (!mnemonic) {
          const generated = Wallet.createRandom();
          const phrase = generated.mnemonic?.phrase;
          if (!phrase) throw new Error('Failed to generate mnemonic');
          mnemonic = phrase;
          localStorage.setItem('linera_mnemonic', mnemonic);
        }

        const signer = PrivateKey.fromMnemonic(mnemonic);
        const faucet = new linera.Faucet(faucetUrl);
        const owner = signer.address();

        const wallet = await faucet.createWallet();
        const chainId = await faucet.claimChain(wallet, owner);

        const clientInstance = await new linera.Client(wallet, signer, false);
        const application = await clientInstance.frontend().application(applicationId);

        setState({
          client: clientInstance,
          wallet,
          chainId,
          application,
          accountOwner: owner,
          ready: true,
          error: undefined,
          reinitializeClient,
        });
      } catch (error) {
        setState({ ready: false, error: error as Error });
      }
    })();
  }, []);

  // Auto re-init on specific global WASM memory abort errors
  useEffect(() => {
    const handler = (evt: ErrorEvent) => {
      const txt = String(evt.message || '');
      const isWasmAbort = txt.includes('linera_web_bg.wasm') && (txt.includes('RuntimeError') || txt.includes('unreachable') || txt.includes('malloc'));
      if (isWasmAbort) {
        // Fire-and-forget reinitialization
        reinitializeClient?.().catch(() => { });
      }
    };
    window.addEventListener('error', handler);
    return () => window.removeEventListener('error', handler);
  }, []);

  return <LineraContext.Provider value={state}>{children}</LineraContext.Provider>;
}
