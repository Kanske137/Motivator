export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_recipes: {
        Row: {
          created_at: string
          customer_options: Json | null
          description: string | null
          id: string
          installation_id: string
          model: string
          name: string
          params: Json
          prompt: string | null
          steps: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_options?: Json | null
          description?: string | null
          id?: string
          installation_id: string
          model: string
          name: string
          params?: Json
          prompt?: string | null
          steps?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_options?: Json | null
          description?: string | null
          id?: string
          installation_id?: string
          model?: string
          name?: string
          params?: Json
          prompt?: string | null
          steps?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_recipes_installation_id_fkey"
            columns: ["installation_id"]
            isOneToOne: false
            referencedRelation: "shopify_app_installations"
            referencedColumns: ["id"]
          },
        ]
      }
      pod_orders: {
        Row: {
          carrier: string | null
          created_at: string
          delivered_at: string | null
          error: string | null
          fulfilled_at: string | null
          id: string
          installation_id: string | null
          last_status: string | null
          payload: Json | null
          provider: string
          provider_order_id: string | null
          raw: Json | null
          shopify_fulfillment_gid: string | null
          shopify_order_gid: string | null
          shopify_order_id: string
          shopify_order_name: string | null
          status: string
          tracking_code: string | null
          tracking_url: string | null
          updated_at: string
        }
        Insert: {
          carrier?: string | null
          created_at?: string
          delivered_at?: string | null
          error?: string | null
          fulfilled_at?: string | null
          id?: string
          installation_id?: string | null
          last_status?: string | null
          payload?: Json | null
          provider?: string
          provider_order_id?: string | null
          raw?: Json | null
          shopify_fulfillment_gid?: string | null
          shopify_order_gid?: string | null
          shopify_order_id: string
          shopify_order_name?: string | null
          status?: string
          tracking_code?: string | null
          tracking_url?: string | null
          updated_at?: string
        }
        Update: {
          carrier?: string | null
          created_at?: string
          delivered_at?: string | null
          error?: string | null
          fulfilled_at?: string | null
          id?: string
          installation_id?: string | null
          last_status?: string | null
          payload?: Json | null
          provider?: string
          provider_order_id?: string | null
          raw?: Json | null
          shopify_fulfillment_gid?: string | null
          shopify_order_gid?: string | null
          shopify_order_id?: string
          shopify_order_name?: string | null
          status?: string
          tracking_code?: string | null
          tracking_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gelato_orders_installation_id_fkey"
            columns: ["installation_id"]
            isOneToOne: false
            referencedRelation: "shopify_app_installations"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_rules: {
        Row: {
          created_at: string
          id: string
          installation_id: string
          material: string
          price: number
          provider: string
          size: string
          updated_at: string
          variant: string
        }
        Insert: {
          created_at?: string
          id?: string
          installation_id: string
          material: string
          price: number
          provider?: string
          size: string
          updated_at?: string
          variant: string
        }
        Update: {
          created_at?: string
          id?: string
          installation_id?: string
          material?: string
          price?: number
          provider?: string
          size?: string
          updated_at?: string
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_rules_installation_id_fkey"
            columns: ["installation_id"]
            isOneToOne: false
            referencedRelation: "shopify_app_installations"
            referencedColumns: ["id"]
          },
        ]
      }
      product_bases: {
        Row: {
          category: string | null
          created_at: string
          id: string
          imported_at: string
          mockup: string
          print_areas: Json
          provider: string
          provider_product_id: string
          raw: Json | null
          title: string
          updated_at: string
          variant_axes: Json
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          imported_at?: string
          mockup?: string
          print_areas?: Json
          provider?: string
          provider_product_id: string
          raw?: Json | null
          title?: string
          updated_at?: string
          variant_axes?: Json
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          imported_at?: string
          mockup?: string
          print_areas?: Json
          provider?: string
          provider_product_id?: string
          raw?: Json | null
          title?: string
          updated_at?: string
          variant_axes?: Json
        }
        Relationships: []
      }
      product_configs: {
        Row: {
          category_gid: string | null
          created_at: string
          description_html: string | null
          enabled_product_types: string[]
          id: string
          installation_id: string | null
          is_consolidated: boolean
          is_freeform: boolean
          layouts: Json
          map_styles: Json
          product_type: string
          sales_channels: string[]
          seo_description: string | null
          seo_title: string | null
          shopify_handle: string
          sizes: Json
          status: string
          tags: string[]
          template: Json
          template_slug: string | null
          text_config: Json
          title: string
          updated_at: string
          variant_map: Json
        }
        Insert: {
          category_gid?: string | null
          created_at?: string
          description_html?: string | null
          enabled_product_types?: string[]
          id?: string
          installation_id?: string | null
          is_consolidated?: boolean
          is_freeform?: boolean
          layouts?: Json
          map_styles?: Json
          product_type: string
          sales_channels?: string[]
          seo_description?: string | null
          seo_title?: string | null
          shopify_handle: string
          sizes?: Json
          status?: string
          tags?: string[]
          template?: Json
          template_slug?: string | null
          text_config?: Json
          title: string
          updated_at?: string
          variant_map?: Json
        }
        Update: {
          category_gid?: string | null
          created_at?: string
          description_html?: string | null
          enabled_product_types?: string[]
          id?: string
          installation_id?: string | null
          is_consolidated?: boolean
          is_freeform?: boolean
          layouts?: Json
          map_styles?: Json
          product_type?: string
          sales_channels?: string[]
          seo_description?: string | null
          seo_title?: string | null
          shopify_handle?: string
          sizes?: Json
          status?: string
          tags?: string[]
          template?: Json
          template_slug?: string | null
          text_config?: Json
          title?: string
          updated_at?: string
          variant_map?: Json
        }
        Relationships: [
          {
            foreignKeyName: "product_configs_installation_id_fkey"
            columns: ["installation_id"]
            isOneToOne: false
            referencedRelation: "shopify_app_installations"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_app_installations: {
        Row: {
          access_token: string
          admin_locale: string | null
          id: string
          installed_at: string
          scopes: string
          shop_domain: string
          storefront_access_token: string | null
          updated_at: string
        }
        Insert: {
          access_token: string
          admin_locale?: string | null
          id?: string
          installed_at?: string
          scopes: string
          shop_domain: string
          storefront_access_token?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          admin_locale?: string | null
          id?: string
          installed_at?: string
          scopes?: string
          shop_domain?: string
          storefront_access_token?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      shopify_sync_state: {
        Row: {
          created_at: string
          id: string
          installation_id: string | null
          last_synced_at: string | null
          last_synced_payload: Json
          product_config_id: string
          shopify_product_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          installation_id?: string | null
          last_synced_at?: string | null
          last_synced_payload?: Json
          product_config_id: string
          shopify_product_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          installation_id?: string | null
          last_synced_at?: string | null
          last_synced_payload?: Json
          product_config_id?: string
          shopify_product_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopify_sync_state_installation_id_fkey"
            columns: ["installation_id"]
            isOneToOne: false
            referencedRelation: "shopify_app_installations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_sync_state_product_config_id_fkey"
            columns: ["product_config_id"]
            isOneToOne: true
            referencedRelation: "product_configs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
