import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'success';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
  loadingText?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', loading = false, loadingText, disabled, type = 'button', children, ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center rounded-md font-bold transition-[background-color,border-color,color,box-shadow,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:pointer-events-none disabled:opacity-50';
    
    const variants = {
      primary: 'forge-button-primary',
      secondary: 'forge-button-secondary',
      outline: 'forge-button-secondary',
      ghost: 'text-slate-700 forge-button-ghost focus-visible:ring-sky-300',
      destructive: 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-300',
      success: 'border border-teal-500 bg-teal-700 text-white shadow-sm hover:bg-teal-800 focus-visible:ring-teal-300'
    };

    const sizes = {
      sm: 'h-8 px-3 text-xs',
      md: 'h-10 px-4 py-2',
      lg: 'h-12 px-8',
      icon: 'h-10 w-10'
    };

    return (
      <button
        ref={ref}
        className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
            {loadingText || 'Loading…'}
          </>
        ) : children}
      </button>
    );
  }
);

Button.displayName = 'Button';
