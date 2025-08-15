'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { signIn } from '@/lib/auth-client';
import { Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';

import Link from 'next/link';

interface SignInPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SignInPromptDialog({ open, onOpenChange }: SignInPromptDialogProps) {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);

  // Обработка отправки Magic Link
  const handleMagicLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error('Пожалуйста, введите email адрес');
      return;
    }
    if (!acceptPrivacy || !acceptTerms) {
      toast.error('Необходимо согласиться с условиями и политикой');
      return;
    }

    setIsLoading(true);
    try {
      await signIn.magicLink({
        email: email.trim(),
        callbackURL: '/',
      });
      setIsSuccess(true);
      toast.success('Magic Link отправлен на ваш email!');
      // Сбрасываем состояние чекбоксов после успешной отправки
      setAcceptPrivacy(false);
      setAcceptTerms(false);
    } catch (error) {
      console.error('Magic Link error:', error);
      toast.error('Ошибка при отправке Magic Link. Попробуйте снова.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[360px] p-6 gap-0">
        {/* Заголовок */}
        <div className="mb-6">
          <h2 className="text-lg font-medium text-foreground mb-1">Sign in to continue</h2>
          <p className="text-sm text-muted-foreground">Save conversations and sync across devices</p>
        </div>

        {isSuccess ? (
          /* Сообщение об успешной отправке */
          <div className="text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center mx-auto">
              <Mail className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-foreground mb-2">Проверьте вашу почту</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Мы отправили ссылку для входа на <strong>{email}</strong>
              </p>
              <p className="text-xs text-muted-foreground">
                Не получили письмо? Проверьте папку спам или попробуйте снова.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setIsSuccess(false);
                setEmail('');
                setAcceptPrivacy(false);
                setAcceptTerms(false);
              }}
              className="w-full"
            >
              Попробовать снова
            </Button>
          </div>
        ) : (
          /* Форма Magic Link */
          <>
            <form onSubmit={handleMagicLinkSubmit} className="space-y-4 mb-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">
                  Email адрес
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  className="w-full"
                  required
                />
              </div>
              
              {/* Чекбоксы согласия */}
              <div className="space-y-3">
                <div className="flex items-start space-x-2">
                  <Checkbox
                    id="privacy"
                    checked={acceptPrivacy}
                    onCheckedChange={(checked) => setAcceptPrivacy(checked === true)}
                    className="mt-0.5"
                  />
                  <Label htmlFor="privacy" className="text-xs text-muted-foreground leading-4">
                    <Link
                      href="/privacy-policy"
                      className="underline underline-offset-2 hover:text-foreground whitespace-nowrap"
                    >
                      Согласие с политикой обработки данных
                    </Link>
                  </Label>
                </div>
                
                <div className="flex items-start space-x-2">
                  <Checkbox
                    id="terms"
                    checked={acceptTerms}
                    onCheckedChange={(checked) => setAcceptTerms(checked === true)}
                    className="mt-0.5"
                  />
                  <Label htmlFor="terms" className="text-xs text-muted-foreground leading-4">
                    <Link
                      href="/terms"
                      className="underline underline-offset-2 hover:text-foreground whitespace-nowrap"
                    >
                      Согласие с условиями сервиса
                    </Link>
                  </Label>
                </div>
              </div>
              
              <Button
                type="submit"
                disabled={isLoading || !email.trim() || !acceptPrivacy || !acceptTerms}
                className="w-full h-10"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Отправляем...
                  </>
                ) : (
                  'Получить ссылку на почту'
                )}
              </Button>
            </form>

            {/* Разделитель */}
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border"></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-2 bg-background text-muted-foreground">или</span>
              </div>
            </div>

            {/* Опция гостя */}
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="w-full h-10 font-normal text-sm"
            >
              Продолжить без аккаунта
            </Button>
          </>
        )}

        {/* Правовая информация */}
        <p className="text-xs text-muted-foreground text-center mt-4">
          Используя сервис вы принимаете{' '}
          <Link
            href="/terms"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Условия
          </Link>
          {' & '}
          <Link
            href="/privacy-policy"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Политику обработки персональных данных
          </Link>
        </p>
      </DialogContent>
    </Dialog>
  );
}
