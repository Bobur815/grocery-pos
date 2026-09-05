import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { ArrowLeft } from 'lucide-react';
import { useSettingsStore } from '../../store/settings-store';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { auth } from '../../api/ipc-client';
import { useToast } from '../../context/ToastContext';

const Container = styled.div`
  max-width: 600px;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding-left: 25px;
`;

const BackButton = styled(Button)``;

const Title = styled.h1`
  margin: 0;
  color: ${({ theme }) => theme.colors.text};
`;

const Section = styled.div`
  background-color: ${({ theme }) => theme.colors.surface};
  padding: ${({ theme }) => theme.spacing.lg};
  border-radius: ${({ theme }) => theme.borderRadius};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const SectionTitle = styled.h2`
  margin: 0 0 ${({ theme }) => theme.spacing.md};
  font-size: 18px;
  color: ${({ theme }) => theme.colors.text};
`;

const OptionRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: ${({ theme }) => theme.spacing.sm} 0;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};

  &:last-child {
    border-bottom: none;
  }
`;

const OptionLabel = styled.span`
  color: ${({ theme }) => theme.colors.text};
`;

const Select = styled.select`
  padding: ${({ theme }) => theme.spacing.sm};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background-color: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.text};
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const PinHint = styled.p`
  margin: 0 0 ${({ theme }) => theme.spacing.md};
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const PinActions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
`;

export function UserSettings() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { mode, toggleTheme } = useTheme();
  const { language, setLanguage } = useSettingsStore();
  const toast = useToast();

  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  // Quick-login PIN — personal to this account and to this terminal.
  const [hasPin, setHasPin] = useState(false);
  const [pinData, setPinData] = useState({ newPin: '', confirmPin: '' });

  useEffect(() => {
    auth.hasPin()?.then((value) => setHasPin(!!value)).catch(() => {});
  }, []);

  const onlyDigits = (value: string) => value.replace(/\D/g, '').slice(0, 4);

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (pinData.newPin !== pinData.confirmPin) {
      toast.error(t('settings.pinMismatch'));
      return;
    }
    if (!/^\d{1,4}$/.test(pinData.newPin)) {
      toast.error(t('auth.errors.invalid_pin_format'));
      return;
    }

    try {
      await auth.setupPin(pinData.newPin);
      setPinData({ newPin: '', confirmPin: '' });
      setHasPin(true);
      toast.success(t('settings.pinChanged'));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('pin_taken')) {
        toast.error(t('auth.errors.pin_taken'));
      } else if (message.includes('invalid_pin_format')) {
        toast.error(t('auth.errors.invalid_pin_format'));
      } else {
        toast.error(t('settings.pinChangeFailed'));
      }
    }
  };

  const handlePinRemove = async () => {
    try {
      await auth.removePin();
      setPinData({ newPin: '', confirmPin: '' });
      setHasPin(false);
      toast.success(t('settings.pinRemoved'));
    } catch {
      toast.error(t('settings.pinChangeFailed'));
    }
  };

  const handleLanguageChange = (lang: string) => {
    setLanguage(lang);
    i18n.changeLanguage(lang);
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error(t('settings.passwordMismatch'));
      return;
    }

    if (passwordData.newPassword.length < 6) {
      toast.error(t('settings.passwordTooShort'));
      return;
    }

    try {
      await auth.changePassword(passwordData.currentPassword, passwordData.newPassword);
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
      toast.success(t('settings.passwordChanged'));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('invalid_password')) {
        toast.error(t('settings.passwordWrong'));
      } else {
        toast.error(t('settings.passwordChangeFailed'));
      }
    }
  };

  return (
    <Container>
      <Header>
        <BackButton variant="secondary" size="small" onClick={() => navigate('/settings')}>
          <ArrowLeft size={20} />
        </BackButton>
        <Title>{t('settings.userSettings')}</Title>
      </Header>

      <Section>
        <SectionTitle>{t('settings.appearance')}</SectionTitle>

        <OptionRow>
          <OptionLabel>{t('settings.language')}</OptionLabel>
          <Select
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value)}
          >
            <option value="ru">Русский</option>
            <option value="uz">O'zbekcha</option>
          </Select>
        </OptionRow>

        <OptionRow>
          <OptionLabel>{t('settings.theme')}</OptionLabel>
          <Select value={mode} onChange={toggleTheme}>
            <option value="light">{t('settings.lightTheme')}</option>
            <option value="dark">{t('settings.darkTheme')}</option>
          </Select>
        </OptionRow>
      </Section>

      <Section>
        <SectionTitle>{t('settings.changePassword')}</SectionTitle>

        <Form onSubmit={handlePasswordSubmit}>
          <Input
            type="password"
            label={t('settings.currentPassword')}
            value={passwordData.currentPassword}
            onChange={(e) =>
              setPasswordData((prev) => ({ ...prev, currentPassword: e.target.value }))
            }
            required
          />

          <Input
            type="password"
            label={t('settings.newPassword')}
            value={passwordData.newPassword}
            onChange={(e) =>
              setPasswordData((prev) => ({ ...prev, newPassword: e.target.value }))
            }
            required
          />

          <Input
            type="password"
            label={t('settings.confirmPassword')}
            value={passwordData.confirmPassword}
            onChange={(e) =>
              setPasswordData((prev) => ({ ...prev, confirmPassword: e.target.value }))
            }
            required
          />

          <Button type="submit">{t('settings.updatePassword')}</Button>
        </Form>
      </Section>

      <Section>
        <SectionTitle>{t('settings.pinCode')}</SectionTitle>
        <PinHint>
          {hasPin ? t('settings.pinSet') : t('settings.pinNotSet')} — {t('settings.pinHint')}
        </PinHint>

        <Form onSubmit={handlePinSubmit}>
          <Input
            type="password"
            inputMode="numeric"
            label={hasPin ? t('settings.newPin') : t('settings.pinCode')}
            value={pinData.newPin}
            onChange={(e) =>
              setPinData((prev) => ({ ...prev, newPin: onlyDigits(e.target.value) }))
            }
            required
          />

          <Input
            type="password"
            inputMode="numeric"
            label={t('settings.confirmPin')}
            value={pinData.confirmPin}
            onChange={(e) =>
              setPinData((prev) => ({ ...prev, confirmPin: onlyDigits(e.target.value) }))
            }
            required
          />

          <PinActions>
            <Button type="submit">
              {hasPin ? t('settings.updatePin') : t('settings.setPin')}
            </Button>
            {hasPin && (
              <Button type="button" variant="secondary" onClick={handlePinRemove}>
                {t('settings.removePin')}
              </Button>
            )}
          </PinActions>
        </Form>
      </Section>
    </Container>
  );
}
