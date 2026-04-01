import toast, { type ToastOptions } from "react-hot-toast";

export const WALLET_STATUS_TOAST_ID = "wallet-status";

type WalletToastOptions = ToastOptions & {
  id?: string;
};

function withToastId(options?: WalletToastOptions): ToastOptions {
  return {
    ...(options ?? {}),
    id: options?.id ?? WALLET_STATUS_TOAST_ID,
  };
}

export function showWalletStatusToast(message: string, options?: WalletToastOptions) {
  return toast(message, withToastId(options));
}

export function showWalletStatusErrorToast(message: string, options?: WalletToastOptions) {
  return toast.error(message, withToastId(options));
}
