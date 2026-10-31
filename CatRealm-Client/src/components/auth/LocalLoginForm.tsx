import { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Spinner } from '../ui/Spinner';

export function LocalLoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { localLogin, loading, error, clearError } = useAuthStore();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    localLogin(username.trim(), password);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Username"
        value={username}
        onChange={(e) => {
          setUsername(e.target.value);
          if (error) clearError();
        }}
        autoFocus
      />
      <Input
        label="Password"
        type="password"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          if (error) clearError();
        }}
      />

      {error && <p className="text-sm text-danger">{error}</p>}

      <Button type="submit" className="w-full" disabled={loading || !username.trim() || !password}>
        {loading ? <Spinner size="sm" /> : 'Log In'}
      </Button>
    </form>
  );
}
