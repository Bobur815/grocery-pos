import React from 'react';
import { Outlet } from 'react-router-dom';
import styled from 'styled-components';
import { Sidebar } from './Sidebar';
import { AppBar, APP_BAR_HEIGHT } from './AppBar';
import { SidebarProvider, useSidebar } from '../../context/SidebarContext';
import { SmenaPage } from '../../pages/Smena/SmenaPage';

const Content = styled.main`
  padding-top: ${APP_BAR_HEIGHT + 4}px;
  padding-left: ${({ theme }) => theme.spacing.xs};
  padding-right: ${({ theme }) => theme.spacing.xs};
  padding-bottom: ${({ theme }) => theme.spacing.xs};
  background-color: ${({ theme }) => theme.colors.background};
  min-height: 100vh;
  overflow-y: auto;
  min-width: 0;
`;

function LayoutInner() {
  const { smenaOpen, closeSmenaModal } = useSidebar();
  return (
    <>
      <AppBar />
      <Sidebar />
      <Content>
        <Outlet />
      </Content>
      {smenaOpen && <SmenaPage onClose={closeSmenaModal} />}
    </>
  );
}

export function Layout() {
  return (
    <SidebarProvider>
      <LayoutInner />
    </SidebarProvider>
  );
}
