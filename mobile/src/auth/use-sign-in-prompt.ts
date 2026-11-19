import { useAuth } from '@/auth/AuthContext';
import { confirmAction } from '@/utils/confirm';

export function useSignInPrompt() {
  const { showSignIn } = useAuth();

  return async (message: string) => {
    if (await confirmAction('Sign in required', message, 'Sign in', 'default')) {
      showSignIn();
    }
  };
}
