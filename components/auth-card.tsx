'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { Loader2, Mail } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

interface AuthCardProps {
  title: string;
  description: string;
  mode?: 'sign-in' | 'sign-up';
}

/**
 * Компонент аутентификации с Magic Link
 */
export default function AuthCard({ title, description, mode = 'sign-in' }: AuthCardProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  // Проверка валидности email
  const isValidEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  // Проверка готовности формы к отправке
  const isFormReady = email && isValidEmail(email) && privacyAccepted && termsAccepted && !loading;

  // Обработка отправки Magic Link
  const handleSendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isFormReady) return;

    setLoading(true);
    
    try {
      await authClient.signIn.magicLink({
        email,
        callbackURL: '/',
      });
      
      setEmailSent(true);
      toast.success('Ссылка отправлена на вашу почту!');
    } catch (error) {
      console.error('Ошибка отправки Magic Link:', error);
      toast.error('Произошла ошибка при отправке ссылки');
    } finally {
      setLoading(false);
    }
  };

  if (emailSent) {
    return (
      <div className="w-full max-w-[380px] mx-auto">
        <div className="space-y-6 text-center">
          <div className="space-y-3">
            <div className="w-16 h-16 mx-auto bg-green-100 rounded-full flex items-center justify-center">
              <Mail className="w-8 h-8 text-green-600" />
            </div>
            <h1 className="text-2xl font-medium">Проверьте почту</h1>
            <p className="text-sm text-muted-foreground/80">
              Мы отправили ссылку для входа на <strong>{email}</strong>
            </p>
          </div>
          
          <div className="pt-6">
            <Button 
              variant="outline" 
              onClick={() => {
                setEmailSent(false);
                setEmail('');
                setPrivacyAccepted(false);
                setTermsAccepted(false);
              }}
              className="w-full"
            >
              Отправить на другую почту
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[380px] mx-auto">
      <div className="space-y-6">
        <div className="text-center space-y-3">
          <h1 className="text-2xl font-medium">Добро пожаловать</h1>
          <p className="text-sm text-muted-foreground/80">Войти или создать аккаунт на Vega</p>
        </div>

        <form onSubmit={handleSendMagicLink} className="space-y-4">
          <div className="space-y-2">
            <Input
              type="email"
              placeholder="Введите ваш email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12"
              required
            />
          </div>

          <Button 
            type="submit" 
            className="w-full h-12" 
            disabled={!isFormReady}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Отправляем...
              </>
            ) : (
              'Получить ссылку на почту'
            )}
          </Button>

          <div className="space-y-3 pt-2">
            <div className="flex items-start space-x-2">
              <Checkbox 
                id="privacy" 
                checked={privacyAccepted}
                onCheckedChange={(checked) => setPrivacyAccepted(checked as boolean)}
                className="mt-0.5"
              />
              <label htmlFor="privacy" className="text-[11px] text-muted-foreground/60 leading-relaxed cursor-pointer">
                Согласие с{' '}
                <Link href="/privacy-policy" className="hover:text-muted-foreground underline-offset-2 underline">
                  политикой обработки персональных данных
                </Link>
              </label>
            </div>

            <div className="flex items-start space-x-2">
              <Checkbox 
                id="terms" 
                checked={termsAccepted}
                onCheckedChange={(checked) => setTermsAccepted(checked as boolean)}
                className="mt-0.5"
              />
              <label htmlFor="terms" className="text-[11px] text-muted-foreground/60 leading-relaxed cursor-pointer">
                Согласие c{' '}
                <Link href="/terms" className="hover:text-muted-foreground underline-offset-2 underline">
                  условиями сервиса
                </Link>
              </label>
            </div>
          </div>
        </form>

        <div className="pt-6">
          <p className="text-sm text-center text-muted-foreground">
            Забыли Email?{' '}
            <a href="mailto:help@vega.chat" className="text-foreground font-medium hover:underline underline-offset-4">
              help@vega.chat
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
