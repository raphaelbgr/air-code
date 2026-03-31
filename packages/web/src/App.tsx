import { useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from '@/stores/auth.store';
import { LoginPage } from '@/components/auth/LoginPage';
import { RegisterPage } from '@/components/auth/RegisterPage';
import { AppLayout } from '@/components/layout/AppLayout';

export default function App() {
  const token = useAuthStore((s) => s.token);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');

  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#252538',
            color: '#e4e4e7',
            border: '1px solid #2e2e42',
          },
        }}
      />
      {token ? (
        <AppLayout />
      ) : authMode === 'login' ? (
        <LoginPage onSwitch={() => setAuthMode('register')} />
      ) : (
        <RegisterPage onSwitch={() => setAuthMode('login')} />
      )}
    </>
  );
}
