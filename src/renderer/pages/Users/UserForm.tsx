import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { UzbekPhoneInput } from '../../components/common/UzbekPhoneInput';
import { isUzPhoneComplete } from '@shared/utils/phone';
import { convertUzbekText } from '@shared/utils/transliterator';
import { USER_ROLES, UserRole} from '@shared/constants';

const Container = styled.div`
  max-width: 500px;
`;

const Title = styled.h1`
  margin: 0 0 ${({ theme }) => theme.spacing.lg};
  color: ${({ theme }) => theme.colors.text};
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const Select = styled.select`
  width: 100%;
  padding: ${({ theme }) => theme.spacing.sm};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background-color: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.text};
`;

const Label = styled.label`
  display: block;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
  font-weight: 500;
  color: ${({ theme }) => theme.colors.text};
`;

const FormGroup = styled.div`
  display: flex;
  flex-direction: column;
`;

const Actions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  margin-top: ${({ theme }) => theme.spacing.lg};
`;

const ErrorMessage = styled.div`
  color: ${({ theme }) => theme.colors.error};
  font-size: 14px;
`;

const PinHint = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-top: ${({ theme }) => theme.spacing.xs};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const PinClearButton = styled.button`
  background: none;
  border: none;
  padding: 0;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.error};
  text-decoration: underline;
  cursor: pointer;
`;

export function UserForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);

  const [formData, setFormData] = useState<{
    phone: string;
    password: string;
    nameRu: string;
    nameUz: string;
    role: UserRole;
    pin: string;
  }>({
    phone: '',
    password: '',
    nameRu: '',
    nameUz: '',
    role: USER_ROLES.USER,
    pin: '',
  });
  // Whether this user already has a quick-login PIN. The hash itself never reaches the renderer,
  // so an empty PIN field on an existing user means "leave it as it is", not "clear it".
  const [hasPin, setHasPin] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isEdit && id) {
      loadUser();
    }
  }, [id, isEdit]);

  const loadUser = async () => {
    try {
      const users = await window.electronAPI.users.getAll();
      const user = (users as Array<{
        id: string;
        phone: string;
        nameRu: string;
        nameUz: string;
        role: UserRole;
        hasPin?: boolean;
      }>).find((u) => u.id === id);

      if (user) {
        const digits = user.phone.startsWith('998') ? user.phone.slice(3) : user.phone;
        setFormData({
          phone: digits,
          password: '',
          nameRu: user.nameRu,
          nameUz: user.nameUz,
          role: user.role || USER_ROLES.USER,
          pin: '',
        });
        setHasPin(!!user.hasPin);
      }
    } catch (error) {
      console.error('Failed to load user:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (isEdit && id) {
        const updateData: Record<string, string | null> = {
          nameRu: formData.nameRu,
          nameUz: formData.nameUz,
          role: formData.role,
        };

        if (formData.password) {
          updateData.password = formData.password;
        }
        if (formData.pin) {
          updateData.pin = formData.pin;
        }

        await window.electronAPI.users.update(id, updateData);
      } else {
        if (!formData.password) {
          setError(t('users.passwordRequired'));
          setIsLoading(false);
          return;
        }

        await window.electronAPI.users.create({
          ...formData,
          pin: formData.pin || undefined,
          phone: '998' + formData.phone,
        });
      }

      navigate('/users');
    } catch (error) {
      setError(error instanceof Error ? error.message : t('common.error'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleRemovePin = async () => {
    if (!id) return;
    setError('');
    try {
      // Explicit null — an empty field means "keep", so clearing has to be asked for.
      await window.electronAPI.users.update(id, { pin: null });
      setFormData((prev) => ({ ...prev, pin: '' }));
      setHasPin(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    }
  };

  // Auto-transliterate between Uzbek Latin and Cyrillic
  const handleNameUzChange = (value: string) => {
    setFormData((prev) => {
      const converted = convertUzbekText(value); // Latin → Cyrillic
      return {
        ...prev,
        nameUz: value,
        nameRu: prev.nameRu === '' || prev.nameRu === convertUzbekText(prev.nameUz)
          ? converted
          : prev.nameRu,
      };
    });
  };

  const handleNameRuChange = (value: string) => {
    setFormData((prev) => {
      const converted = convertUzbekText(value); // Cyrillic → Latin
      return {
        ...prev,
        nameRu: value,
        nameUz: prev.nameUz === '' || prev.nameUz === convertUzbekText(prev.nameRu)
          ? converted
          : prev.nameUz,
      };
    });
  };

  return (
    <Container>
      <Title>{isEdit ? t('users.editUser') : t('users.addUser')}</Title>

      <Form onSubmit={handleSubmit}>
        <UzbekPhoneInput
          label={t('users.phone')}
          valueDigits={formData.phone}
          onDigitsChange={(digits) => handleChange('phone', digits)}
          disabled={isEdit}
          autoFocus
        />

        <Input
          label={isEdit ? t('users.newPassword') : t('users.password')}
          type="password"
          value={formData.password}
          onChange={(e) => handleChange('password', e.target.value)}
          required={!isEdit}
          placeholder={isEdit ? t('users.leaveBlankToKeep') : ''}
        />

        <Input
          label={t('users.nameUz')}
          value={formData.nameUz}
          onChange={(e) => handleNameUzChange(e.target.value)}
          required
        />

        <Input
          label={t('users.nameRu')}
          value={formData.nameRu}
          onChange={(e) => handleNameRuChange(e.target.value)}
          required
        />

        <FormGroup>
          <Label>{t('users.role')}</Label>
          <Select
            value={formData.role}
            onChange={(e) => handleChange('role', e.target.value)}
          >
            <option value="USER">{t('users.cashier')}</option>
            <option value="ADMIN">{t('users.admin')}</option>
          </Select>
        </FormGroup>

        <FormGroup>
          <Input
            label={t('users.pin')}
            type="password"
            inputMode="numeric"
            value={formData.pin}
            onChange={(e) => handleChange('pin', e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder={hasPin ? t('users.leaveBlankToKeep') : ''}
          />
          <PinHint>
            {hasPin ? t('users.pinSet') : t('users.pinHint')}
            {hasPin && (
              <PinClearButton type="button" onClick={handleRemovePin}>
                {t('users.removePin')}
              </PinClearButton>
            )}
          </PinHint>
        </FormGroup>

        {error && <ErrorMessage>{error}</ErrorMessage>}

        <Actions>
          <Button type="button" variant="secondary" onClick={() => navigate('/users')}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={isLoading || (!isEdit && !isUzPhoneComplete(formData.phone))}>
            {isLoading ? t('common.saving') : t('common.save')}
          </Button>
        </Actions>
      </Form>
    </Container>
  );
}
