import * as fs from "fs";
import * as path from "path";

export interface WeeklyProgressTemplateData {
  childName: string;
  sessionCount: number;
  moodIcon: string;
  moodStatus: string;
  moodSummary: string;
  wins?: string[];
  weeklyInsight: {
    story: string;
    what_happened: string;
    good_news: string;
  };
  actionPlan: {
    steps: Array<{
      timeframe: string;
      action: string;
      description: string;
    }>;
    quick_win: string;
  };
}

/**
 * Simple template engine for HTML email templates
 * Supports basic variable interpolation and simple conditionals/loops
 */
export class EmailTemplateEngine {
  private templateCache: Map<string, string> = new Map();

  /**
   * Load and cache a template file
   */
  private loadTemplate(templateName: string): string {
    if (this.templateCache.has(templateName)) {
      return this.templateCache.get(templateName)!;
    }

    const templatePath = path.join(__dirname, "..", "templates", templateName);
    const template = fs.readFileSync(templatePath, "utf-8");
    this.templateCache.set(templateName, template);
    return template;
  }

  /**
   * Render a template with the provided data
   */
  render(templateName: string, data: WeeklyProgressTemplateData): string {
    let template = this.loadTemplate(templateName);

    // Replace simple variables {{variable}}
    template = template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
      return this.getNestedValue(data, path) || match;
    });

    // Handle {{#if wins}} conditional blocks
    template = template.replace(
      /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
      (match, condition, content) => {
        const value = this.getNestedValue(data, condition);
        return value && Array.isArray(value) && value.length > 0 ? content : "";
      }
    );

    // Handle {{#each array}} loops
    template = template.replace(
      /\{\{#each\s+(\w+(?:\.\w+)*)\}\}([\s\S]*?)\{\{\/each\}\}/g,
      (match, arrayPath, itemTemplate) => {
        const array = this.getNestedValue(data, arrayPath);
        if (!Array.isArray(array)) return "";

        return array
          .map((item) => {
            let renderedItem = itemTemplate;

            // Handle {{this}} for simple arrays
            renderedItem = renderedItem.replace(/\{\{this\}\}/g, String(item));

            // Handle object properties in each loop
            if (typeof item === "object" && item !== null) {
              renderedItem = renderedItem.replace(
                /\{\{(\w+)\}\}/g,
                (propMatch: string, prop: string) => {
                  return String(item[prop] || propMatch);
                }
              );
            }

            return renderedItem;
          })
          .join("");
      }
    );

    return template;
  }

  /**
   * Get nested object value using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split(".").reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  }
}

// Export singleton instance
export const emailTemplateEngine = new EmailTemplateEngine();

/**
 * Generate HTML email for weekly progress
 */
export function generateWeeklyProgressHTML(
  data: WeeklyProgressTemplateData
): string {
  return emailTemplateEngine.render("weekly-progress-email.html", data);
}
