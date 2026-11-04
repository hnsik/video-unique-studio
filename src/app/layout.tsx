import "./globals.css";
export const metadata = {
  title: "Video Unique Studio Advanced 2.0",
  description: "Локальный редактор и пакетная обработка видео",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
