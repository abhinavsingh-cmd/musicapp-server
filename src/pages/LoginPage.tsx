import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { cn } from '../utils/cn';
import { Mail, Lock, Music } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 overflow-hidden relative">
      {/* Floating background orbs */}
      <motion.div
        className="absolute w-72 h-72 bg-purple-300/30 dark:bg-purple-500/10 rounded-full blur-3xl"
        animate={{ x: [0, 50, -30, 0], y: [0, -40, 30, 0], scale: [1, 1.2, 0.9, 1] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        style={{ top: '10%', left: '10%' }}
      />
      <motion.div
        className="absolute w-96 h-96 bg-pink-300/30 dark:bg-pink-500/10 rounded-full blur-3xl"
        animate={{ x: [0, -60, 40, 0], y: [0, 50, -30, 0], scale: [1, 0.8, 1.3, 1] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        style={{ bottom: '10%', right: '10%' }}
      />
      <motion.div
        className="absolute w-64 h-64 bg-blue-300/20 dark:bg-blue-500/10 rounded-full blur-3xl"
        animate={{ x: [0, 30, -50, 0], y: [0, -60, 20, 0] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        style={{ top: '50%', right: '30%' }}
      />

      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
        className="w-full max-w-md p-8 claymorphism dark:claymorphism-dark rounded-3xl relative z-10 mx-4"
      >
        <div className="text-center mb-8">
          <motion.div
            className="flex justify-center mb-4"
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ duration: 0.6, delay: 0.2, type: 'spring', stiffness: 200 }}
          >
            <div className="w-16 h-16 bg-gradient-to-br from-purple-400 via-pink-500 to-red-400 rounded-2xl flex items-center justify-center shadow-lg gradient-animated">
              <Music size={32} className="text-white" />
            </div>
          </motion.div>
          <motion.h1
            className="text-3xl font-bold text-white mb-2"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            Welcome Back
          </motion.h1>
          <motion.p
            className="text-gray-600 dark:text-gray-400"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            Sign in to your MusicApp account
          </motion.p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 }}
          >
            <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
              Email
            </label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Mail size={20} className="text-gray-400 group-focus-within:text-purple-500 transition-colors" />
              </div>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-white/5 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80 focus:ring-0 focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-300 outline-none"
                required
              />
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 }}
          >
            <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
              Password
            </label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Lock size={20} className="text-gray-400 group-focus-within:text-purple-500 transition-colors" />
              </div>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter any password"
                className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-white/5 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80 focus:ring-0 focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-300 outline-none"
                required
              />
            </div>
          </motion.div>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: -10, height: 0 }}
                className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          <motion.button
            type="submit"
            disabled={isLoading}
            whileHover={{ scale: 1.02, boxShadow: '0 10px 40px rgba(124, 58, 237, 0.4)' }}
            whileTap={{ scale: 0.98 }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, type: 'spring', stiffness: 300 }}
            className={cn(
              "w-full py-3.5 px-4 rounded-xl font-semibold text-white btn-ripple",
              "bg-gradient-to-r from-purple-500 via-pink-500 to-red-400",
              "shadow-lg shadow-purple-500/25",
              "disabled:opacity-50 disabled:cursor-not-allowed gradient-animated"
            )}
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <motion.div
                  className="w-5 h-5 border-2 border-white border-t-transparent rounded-full"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                />
                Signing in...
              </span>
            ) : 'Sign In'}
          </motion.button>
        </form>

        <motion.div
          className="mt-8 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
        >
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Demo: <span className="font-semibold text-purple-500">alex@example.com</span>,{' '}
            <span className="font-semibold text-purple-500">maria@example.com</span>,{' '}
            <span className="font-semibold text-purple-500">david@example.com</span>
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
            Any password works. Or sign up with any email.
           </p>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default LoginPage;
