import { useTranslation } from "react-i18next";
import React from "react";
import styled from "styled-components";

interface Column<T> {
  key: Extract<keyof T, string> | string;
  header: string;
  render?: (item: T, index: number) => React.ReactNode;
}

interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
  footer?: React.ReactNode;
  tfoot?: React.ReactNode;
  /** When set, rows become clickable (pointer cursor + click handler). */
  onRowClick?: (item: T, index: number) => void;
}

const Container = styled.div`
  overflow-x: auto;
  background-color: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius};
  box-shadow: ${({ theme }) => theme.shadows.sm};
`;
  
const StyledTable = styled.table`
  width: 100%;
  border-collapse: collapse;
`;

const Thead = styled.thead`
  background-color: ${({ theme }) => theme.colors.background};
`;

const Th = styled.th`
  padding: ${({ theme }) => theme.spacing.md};
  text-align: left;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const Tbody = styled.tbody``;

const Tr = styled.tr<{ $clickable?: boolean }>`
  cursor: ${({ $clickable }) => ($clickable ? "pointer" : "inherit")};

  &:hover {
    background-color: ${({ theme }) => theme.colors.background};
  }
`;

const Td = styled.td`
  padding: ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.text};
  font-size: 14px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const EmptyRow = styled.tr``;

const EmptyCell = styled.td`
  padding: ${({ theme }) => theme.spacing.xl};
  text-align: center;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const LoadingOverlay = styled.div`
  padding: ${({ theme }) => theme.spacing.xl};
  text-align: center;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

export function Table<T>({
  columns,
  data,
  loading = false,
  emptyMessage = "No data",
  footer,
  tfoot,
  onRowClick,
}: TableProps<T>) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <Container>
        <LoadingOverlay>{t("common.loading")}</LoadingOverlay>
      </Container>
    );
  }

  return (
    <Container>
      <StyledTable>
        <Thead>
          <tr>
            {columns.map((column) => (
              <Th key={column.key}>{column.header}</Th>
            ))}
          </tr>
        </Thead>
        <Tbody>
          {data.length === 0 ? (
            <EmptyRow>
              <EmptyCell colSpan={columns.length}>{emptyMessage}</EmptyCell>
            </EmptyRow>
          ) : (
            data.map((item, index) => (
              <Tr
                key={index}
                $clickable={!!onRowClick}
                onClick={onRowClick ? () => onRowClick(item, index) : undefined}
              >
                {columns.map((column) => (
                  <Td key={column.key}>
                    {column.render
                      ? column.render(item, index)
                      : (item as any)[column.key]}
                  </Td>
                ))}
              </Tr>
            ))
          )}
        </Tbody>
        {tfoot && <tfoot>{tfoot}</tfoot>}
      </StyledTable>
      {footer}
    </Container>
  );
}
