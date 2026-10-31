import { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Spinner } from '../ui/Spinner';

export function LocalRegisterForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [validationError, setValidationError] = useState('');
  const { localRegister, loading, error, clearError } = useAuthStore();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError('');

    if (username.length < 4 || username.length > 32) {
      setValidationError('Username must be 4-32 characters');
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setValidationError('Username can only contain letters, numbers, and underscores');
      return;
    }
    if (password.length < 6) {
      setValidationError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirm) {
      setValidationError('Passwords do not match');
      return;
    }

    localRegister(username.trim(), password);
  };

  const displayError = validationError || error;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Username"
        value={username}
        onChange={(e) => {
          setUsername(e.target.value);
          setValidationError('');
          if (error) clearError();
        }}
        autoFocus
        minLength={4}
        maxLength={32}
      />
      <p className="text-xs text-text-secondary">4-32 characters; letters, numbers, and underscores.</p>
      <Input
        label="Password"
        type="password"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          setValidationError('');
          if (error) clearError();
        }}
      />
      <Input
        label="Confirm Password"
        type="password"
        value={confirm}
        onChange={(e) => {
          setConfirm(e.target.value);
          setValidationError('');
        }}
      />

      {displayError && <p className="text-sm text-danger">{displayError}</p>}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <Spinner size="sm" /> : 'Create Account'}
      </Button>
    </form>
  );
}
